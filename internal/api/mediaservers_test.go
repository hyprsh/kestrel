package api_test

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/app"
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
	s := newSearchBare(t, func(o *app.Options) {
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
	t.Parallel()
	s, ms := newMediaSearch(t)
	s.addMovie(t, `{"slot":"standard","profile":"hd-primary"}`)
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
	t.Parallel()
	s, ms := newMediaSearch(t)
	ms.FailWith(plugin.Errorf(plugin.CodeUnavailable, "connection refused"))
	s.addMovie(t, `{"slot":"standard","profile":"hd-primary"}`)
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

// newMediaAdopting is Kestrel with the fake TMDB, Movie roots to scan and one
// configured media server.
func newMediaAdopting(t *testing.T) (adopting, *msfake.Server) {
	t.Helper()
	ms := msfake.New("mk")
	a := newAdopting(t, func(o *app.Options) {
		o.Plugins = plugin.NewRegistry()
		if err := o.Plugins.Register(mediaserver.Contract, ms); err != nil {
			t.Fatal(err)
		}
		o.MediaRefreshDelay = 30 * time.Millisecond
	})
	if r := a.valid("POST", "/plugin-instances", `{"plugin_id":"fake_media_server","name":"Plex","config":{"token":"mk"}}`); r.Status != 201 {
		t.Fatalf("media server = %d %s", r.Status, r.Body)
	}
	return a, ms
}

func TestAdoptingATitleTellsTheMediaServersItsFolder(t *testing.T) {
	t.Parallel()
	a, ms := newMediaAdopting(t)
	a.put(t, "Paddington.2014.1080p.BluRay.x264-GRP/Paddington.2014.1080p.BluRay.x264-GRP.mkv", "movie")

	a.commit(t, a.scan(t).Revision)

	folder := filepath.Join(a.movies, "Paddington (2014) {tmdb-116149}")
	if got := waitRefreshed(t, ms, 1); got[0] != folder {
		t.Fatalf("refreshed %v, want %s", got, folder)
	}
}

func TestCleaningUpATitleFolderTellsTheMediaServers(t *testing.T) {
	t.Parallel()
	a, ms := newMediaAdopting(t)
	a.put(t, "Paddington.2014.1080p.BluRay.x264-GRP/Paddington.2014.1080p.BluRay.x264-GRP.mkv", "movie")
	a.commit(t, a.scan(t).Revision)
	id := a.titleIDOf(t, 116149)
	dir := filepath.Dir(a.titleFiles(t, id)["standard"])
	waitRefreshed(t, ms, 1)
	if err := os.WriteFile(filepath.Join(dir, "release.nfo"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	pv := decode[cleanupPreviewJSON](t, a.valid("POST", "/cleanup/preview", fmt.Sprintf(`{"title_id":%d}`, id)))

	if r := a.valid("POST", "/cleanup/run", fmt.Sprintf(`{"preview_id":%q,"categories":["junk"]}`, pv.PreviewID)); r.Status != 202 {
		t.Fatalf("run = %d %s", r.Status, r.Body)
	}

	got := waitRefreshed(t, ms, 2)
	if got[len(got)-1] != dir {
		t.Fatalf("refreshed %v, want %s last", got, dir)
	}
}
