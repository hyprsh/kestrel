// Package conformance is the media_server.v1 conformance suite. Every adapter,
// and the in-memory fake, runs it with Run.
package conformance

import (
	"context"
	"errors"
	"testing"

	"github.com/hyprsh/kestrel/internal/plugin"
	mediaserver "github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1"
	"github.com/hyprsh/kestrel/internal/plugin/plugintest"
)

// Backend lets the suite see the server's side of the world.
type Backend interface {
	// Refreshed lists the folders the server was told about so far, in order.
	Refreshed() []string
}

// Subject is what the suite exercises.
type Subject struct {
	Server mediaserver.Server
	// Conn reaches a working server; BadAuth one that rejects the credentials;
	// Unreachable points at nothing listening.
	Conn, BadAuth, Unreachable plugin.Connection
	Backend                    Backend
	// Folder is a path the server accepts; Unplaceable is one it cannot place,
	// or empty when the server accepts every path.
	Folder, Unplaceable string
}

func code(t *testing.T, err error, want plugin.Code) {
	t.Helper()
	var pe *plugin.Error
	if !errors.As(err, &pe) {
		t.Fatalf("want a %s *plugin.Error, got %T: %v", want, err, err)
	}
	if pe.Code != want {
		t.Fatalf("want code %s, got %s (%s)", want, pe.Code, pe.Message)
	}
}

// Run runs the whole suite against s.
func Run(t *testing.T, s Subject) {
	ctx := context.Background()
	srv := s.Server

	t.Run("manifest describes a valid media server", func(t *testing.T) {
		m := srv.Describe()
		if err := m.Validate(); err != nil {
			t.Fatal(err)
		}
		if m.Contract != mediaserver.Contract.ID {
			t.Fatalf("contract %q", m.Contract)
		}
	})

	t.Run("Test passes for good credentials and says why it fails otherwise", func(t *testing.T) {
		if _, err := srv.Test(ctx, s.Conn); err != nil {
			t.Fatalf("Test: %v", err)
		}
		_, err := srv.Test(ctx, s.BadAuth)
		code(t, err, plugin.CodeAuth)
		_, err = srv.Test(ctx, s.Unreachable)
		code(t, err, plugin.CodeUnavailable)
	})

	t.Run("a refresh reaches the server with the folder as given", func(t *testing.T) {
		before := len(s.Backend.Refreshed())
		err := srv.Refresh(ctx, s.Conn, []mediaserver.Change{{Path: s.Folder, Kind: mediaserver.Created}})
		if err != nil {
			t.Fatalf("Refresh: %v", err)
		}
		got := s.Backend.Refreshed()
		if len(got) != before+1 || got[len(got)-1] != s.Folder {
			t.Fatalf("server was told %v", got)
		}
	})

	t.Run("a deletion is refreshed too", func(t *testing.T) {
		before := len(s.Backend.Refreshed())
		if err := srv.Refresh(ctx, s.Conn, []mediaserver.Change{{Path: s.Folder, Kind: mediaserver.Deleted}}); err != nil {
			t.Fatalf("Refresh: %v", err)
		}
		if len(s.Backend.Refreshed()) != before+1 {
			t.Fatal("deletion did not reach the server")
		}
	})

	t.Run("refresh failures are classified", func(t *testing.T) {
		ch := []mediaserver.Change{{Path: s.Folder, Kind: mediaserver.Modified}}
		code(t, srv.Refresh(ctx, s.BadAuth, ch), plugin.CodeAuth)
		code(t, srv.Refresh(ctx, s.Unreachable, ch), plugin.CodeUnavailable)
	})

	if s.Unplaceable != "" {
		t.Run("a folder in no library is not_found and not sent", func(t *testing.T) {
			err := srv.Refresh(ctx, s.Conn, []mediaserver.Change{{Path: s.Unplaceable, Kind: mediaserver.Created}})
			code(t, err, plugin.CodeNotFound)
			for _, f := range s.Backend.Refreshed() {
				if f == s.Unplaceable {
					t.Fatal("an unplaceable folder was sent")
				}
			}
		})
	}

	plugintest.RoundTrip[mediaserver.Change](t)
	plugintest.RoundTrip[plugin.Manifest](t)
	plugintest.RoundTrip[plugin.Connection](t)
	plugintest.RoundTrip[plugin.Error](t)
	plugintest.RoundTrip[plugin.TestResult](t)
}
