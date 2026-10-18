package api_test

import (
	"fmt"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/api"
	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/plugin"
	mediaserver "github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1"
	msfake "github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1/fake"
)

// newMediaSearch is newSearchBare with the fake media server registered and
// one instance of it configured.
func newMediaSearch(t *testing.T) (search, *msfake.Server) {
	t.Helper()
	ms := msfake.New("mk")
	s := newSearchBare(t, func(o *api.Options) {
		if err := o.Plugins.Register(mediaserver.Contract, ms); err != nil {
			t.Fatal(err)
		}
		o.MediaRefreshDelay = 30 * time.Millisecond
	})
	if r := s.valid("POST", "/plugin-instances", `{"plugin_id":"fake_media_server","name":"Plex","config":{"token":"mk"}}`); r.Status != 201 {
		t.Fatalf("media server = %d %s", r.Status, r.Body)
	}
	return s, ms
}

func waitRefreshed(t *testing.T, ms *msfake.Server, n int) []string {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for len(ms.Refreshed()) < n {
		if time.Now().After(deadline) {
			t.Fatalf("media server was told %v, want %d refreshes", ms.Refreshed(), n)
		}
		time.Sleep(5 * time.Millisecond)
	}
	return ms.Refreshed()
}

func TestAnImportRefreshesTheMediaServersAndDeletingTheTitleDoesToo(t *testing.T) {
	s, ms := newMediaSearch(t)
	s.addMovie(t, `{"slot":"hd","profile":"hd-primary"}`)
	s.prober.set(goodProbe(), nil)
	s.download(t, map[string]string{"paddington.mkv": "the movie"})
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)
	folder := filepath.Dir(s.version(t, s.hd).File.Path)

	got := waitRefreshed(t, ms, 1)
	if len(got) != 1 || got[0] != folder {
		t.Fatalf("refreshed %v, want the Title folder %s", got, folder)
	}

	if r := s.valid("DELETE", fmt.Sprintf("/titles/%d?delete_files=true", s.title), ""); r.Status != 204 {
		t.Fatalf("DELETE = %d %s", r.Status, r.Body)
	}
	got = waitRefreshed(t, ms, 2)
	if !slices.Equal(got, []string{folder, folder}) {
		t.Fatalf("refreshed %v", got)
	}
}

func TestAFailingMediaServerRaisesAWarningAndTheImportStillSucceeds(t *testing.T) {
	s, ms := newMediaSearch(t)
	ms.FailWith(plugin.Errorf(plugin.CodeUnavailable, "connection refused"))
	s.addMovie(t, `{"slot":"hd","profile":"hd-primary"}`)
	s.prober.set(goodProbe(), nil)
	s.download(t, map[string]string{"paddington.mkv": "the movie"})
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)
	if v := s.version(t, s.hd); v.File == nil || v.State != "filled" {
		t.Fatalf("version = %+v, want filled", v)
	}
	deadline := time.Now().Add(5 * time.Second)
	for !s.attention(t).has("refresh_failed") {
		if time.Now().After(deadline) {
			t.Fatalf("no refresh_failed row: %v", s.attention(t).kinds())
		}
		time.Sleep(10 * time.Millisecond)
	}
	row := s.attention(t).row(t, "refresh_failed")
	if row.Severity != "warning" {
		t.Errorf("row = %+v", row)
	}
	row.action(t, "test")
}
