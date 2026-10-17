// Package conformance is the download_client.v1 conformance suite. Every
// adapter, and the in-memory fake, runs it with Run. It is the executable
// definition of the contract: a behaviour the host relies on is asserted here,
// once, for all implementations.
package conformance

import (
	"context"
	"errors"
	"testing"

	"github.com/hyprsh/kestrel/internal/plugin"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
	"github.com/hyprsh/kestrel/internal/plugin/plugintest"
)

// Backend lets the suite move the client's side of the world along. An adapter
// test implements it over its fake server; the in-memory fake implements it
// directly.
type Backend interface {
	// Complete finishes the job successfully with its files at outputPath.
	Complete(clientID, outputPath string) error
	// Fail ends the job with the given failure and the client's message.
	Fail(clientID string, failure downloadclient.Failure, message string) error
}

// Subject is what the suite exercises.
type Subject struct {
	Client downloadclient.Client
	// Conn reaches a working client.
	Conn plugin.Connection
	// BadAuth reaches the same client but with credentials it rejects.
	BadAuth plugin.Connection
	// Unreachable points at nothing listening.
	Unreachable plugin.Connection
	Backend     Backend
	// Category is one the client accepts for Conn; OtherCategory is a second one.
	Category, OtherCategory string
}

var nzb = []byte(`<?xml version="1.0"?><nzb xmlns="http://www.newzbin.com/DTD/2003/nzb"></nzb>`)

// Run runs the whole suite against s.
func Run(t *testing.T, s Subject) {
	ctx := context.Background()
	add := func(t *testing.T, name, category string) string {
		t.Helper()
		id, err := s.Client.Add(ctx, s.Conn, downloadclient.AddRequest{
			Kind: downloadclient.PayloadNZB, Data: nzb, Filename: name, Category: category, Priority: 0,
		})
		if err != nil {
			t.Fatalf("Add: %v", err)
		}
		if id == "" {
			t.Fatal("Add returned an empty client id")
		}
		return id
	}
	find := func(t *testing.T, category, id string) (downloadclient.Item, bool) {
		t.Helper()
		items, err := s.Client.List(ctx, s.Conn, category)
		if err != nil {
			t.Fatalf("List: %v", err)
		}
		for _, it := range items {
			if it.ClientID == id {
				return it, true
			}
		}
		return downloadclient.Item{}, false
	}
	code := func(t *testing.T, err error, want plugin.Code) {
		t.Helper()
		if err == nil {
			t.Fatalf("want a %s error, got none", want)
		}
		var pe *plugin.Error
		if !errors.As(err, &pe) {
			t.Fatalf("want *plugin.Error, got %T: %v", err, err)
		}
		if pe.Code != want {
			t.Fatalf("want code %s, got %s (%s)", want, pe.Code, pe.Message)
		}
	}

	t.Run("manifest describes a valid download client", func(t *testing.T) {
		m := s.Client.Describe()
		if err := m.Validate(); err != nil {
			t.Fatal(err)
		}
		if m.Contract != downloadclient.Contract.ID {
			t.Fatalf("contract %q", m.Contract)
		}
		if len(m.Capabilities["protocols"]) == 0 {
			t.Fatal("capabilities.protocols must name usenet and/or torrent")
		}
		for _, p := range m.Capabilities["protocols"] {
			if p != "usenet" && p != "torrent" {
				t.Fatalf("unknown protocol %q", p)
			}
		}
	})

	t.Run("Test passes for good credentials and says why it fails otherwise", func(t *testing.T) {
		if _, err := s.Client.Test(ctx, s.Conn); err != nil {
			t.Fatalf("Test: %v", err)
		}
		_, err := s.Client.Test(ctx, s.BadAuth)
		code(t, err, plugin.CodeAuth)
		_, err = s.Client.Test(ctx, s.Unreachable)
		code(t, err, plugin.CodeUnavailable)
	})

	t.Run("an added job is listed in its category with its client id", func(t *testing.T) {
		id := add(t, "Movie.2024.1080p.WEB-DL", s.Category)
		it, ok := find(t, s.Category, id)
		if !ok {
			t.Fatal("added job is not listed")
		}
		if it.Category != s.Category {
			t.Errorf("category %q", it.Category)
		}
		if it.Phase != downloadclient.PhaseQueued && it.Phase != downloadclient.PhaseDownloading {
			t.Errorf("a fresh job is %q", it.Phase)
		}
		if it.Failure != "" {
			t.Errorf("a running job has failure %q", it.Failure)
		}
		if it.BytesLeft > it.BytesTotal {
			t.Errorf("bytes_left %d exceeds bytes_total %d", it.BytesLeft, it.BytesTotal)
		}
		if _, other := find(t, s.OtherCategory, id); other {
			t.Error("job appears in another category's listing")
		}
		if _, all := find(t, "", id); !all {
			t.Error("job missing from the unfiltered listing")
		}
	})

	t.Run("a finished job reports its files and that they may be moved", func(t *testing.T) {
		id := add(t, "Done.Movie.2024", s.Category)
		if err := s.Backend.Complete(id, "/data/complete/Done.Movie.2024"); err != nil {
			t.Fatal(err)
		}
		it, ok := find(t, s.Category, id)
		if !ok {
			t.Fatal("completed job is not listed")
		}
		if it.Phase != downloadclient.PhaseCompleted {
			t.Fatalf("phase %q", it.Phase)
		}
		if it.OutputPath != "/data/complete/Done.Movie.2024" {
			t.Errorf("output path %q", it.OutputPath)
		}
		if !it.CanRemove {
			t.Error("a finished usenet job must be removable")
		}
		if it.Failure != "" {
			t.Errorf("failure %q on a completed job", it.Failure)
		}
	})

	for _, f := range []downloadclient.Failure{downloadclient.FailureFailed, downloadclient.FailureEncrypted, downloadclient.FailureOther} {
		t.Run("a "+string(f)+" job is classified so the host can react", func(t *testing.T) {
			id := add(t, "Bad."+string(f), s.Category)
			if err := s.Backend.Fail(id, f, "client says so"); err != nil {
				t.Fatal(err)
			}
			it, ok := find(t, s.Category, id)
			if !ok {
				t.Fatal("failed job is not listed")
			}
			if it.Phase != downloadclient.PhaseFailed || it.Failure != f {
				t.Fatalf("phase %q failure %q", it.Phase, it.Failure)
			}
		})
	}

	t.Run("Remove drops the job, and removing it again is fine", func(t *testing.T) {
		id := add(t, "Remove.Me", s.Category)
		if err := s.Client.Remove(ctx, s.Conn, id, true); err != nil {
			t.Fatalf("Remove: %v", err)
		}
		if _, ok := find(t, s.Category, id); ok {
			t.Fatal("removed job is still listed")
		}
		if err := s.Client.Remove(ctx, s.Conn, id, true); err != nil {
			t.Fatalf("second Remove: %v", err)
		}
	})

	t.Run("a finished job can be removed without its data", func(t *testing.T) {
		id := add(t, "Keep.Files", s.Category)
		if err := s.Backend.Complete(id, "/data/complete/Keep.Files"); err != nil {
			t.Fatal(err)
		}
		if err := s.Client.Remove(ctx, s.Conn, id, false); err != nil {
			t.Fatalf("Remove: %v", err)
		}
		if _, ok := find(t, s.Category, id); ok {
			t.Fatal("removed job is still listed")
		}
	})

	t.Run("Add refuses an empty payload", func(t *testing.T) {
		_, err := s.Client.Add(ctx, s.Conn, downloadclient.AddRequest{Kind: downloadclient.PayloadNZB, Filename: "x", Category: s.Category})
		code(t, err, plugin.CodeInvalid)
	})

	t.Run("calls with bad credentials fail with auth", func(t *testing.T) {
		_, err := s.Client.List(ctx, s.BadAuth, "")
		code(t, err, plugin.CodeAuth)
		_, err = s.Client.Add(ctx, s.BadAuth, downloadclient.AddRequest{Kind: downloadclient.PayloadNZB, Data: nzb, Filename: "x", Category: s.Category})
		code(t, err, plugin.CodeAuth)
	})

	// ADR 0008: every contract type must survive JSON, so a plugin can leave the process later.
	plugintest.RoundTrip[downloadclient.AddRequest](t)
	plugintest.RoundTrip[downloadclient.Item](t)
	plugintest.RoundTrip[plugin.Manifest](t)
	plugintest.RoundTrip[plugin.Connection](t)
	plugintest.RoundTrip[plugin.Error](t)
	plugintest.RoundTrip[plugin.TestResult](t)
	plugintest.RoundTrip[plugin.Option](t)
}
