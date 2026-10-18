package imports_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/health"
	"github.com/hyprsh/kestrel/internal/imports"
	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1/fake"
)

type stubServers []imports.MediaServer

func (s stubServers) MediaServers(context.Context) ([]imports.MediaServer, error) { return s, nil }

type stubHealth struct {
	mu     sync.Mutex
	raised map[string]health.Issue
}

func (h *stubHealth) Raise(_ context.Context, is health.Issue) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.raised == nil {
		h.raised = map[string]health.Issue{}
	}
	h.raised[is.Key] = is
	return nil
}

func (h *stubHealth) Clear(_ context.Context, key string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.raised, key)
	return nil
}

func (h *stubHealth) keys() map[string]health.Issue {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := map[string]health.Issue{}
	for k, v := range h.raised {
		out[k] = v
	}
	return out
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("timed out")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func refresher(t *testing.T, delay time.Duration, srvs ...imports.MediaServer) (*imports.Refresher, *stubHealth) {
	t.Helper()
	h := &stubHealth{}
	r := imports.NewRefresher(imports.RefresherDeps{Servers: stubServers(srvs), Health: h, Delay: delay})
	t.Cleanup(r.Close)
	return r, h
}

func fakeServer(f *fake.Server, id int64, name string) imports.MediaServer {
	return imports.MediaServer{InstanceID: id, Name: name, PluginID: "fake", Server: f, Conn: f.Conn(id)}
}

func TestSeveralChangesToOneFolderWithinTheDelayRefreshOnce(t *testing.T) {
	f := fake.New("k")
	r, _ := refresher(t, 40*time.Millisecond, fakeServer(f, 1, "Plex"))
	for range 3 {
		r.FolderChanged(context.Background(), "/data/media/movies/Dune (2021)")
	}
	r.FolderChanged(context.Background(), "/data/media/movies/Arrival (2016)")
	waitFor(t, func() bool { return len(f.Refreshed()) >= 2 })
	time.Sleep(120 * time.Millisecond)
	got := f.Refreshed()
	if len(got) != 2 {
		t.Fatalf("refreshed %v, want one refresh per folder", got)
	}
}

func TestNothingIsSentBeforeTheDelay(t *testing.T) {
	f := fake.New("k")
	r, _ := refresher(t, time.Hour, fakeServer(f, 1, "Plex"))
	r.FolderChanged(context.Background(), "/data/media/movies/Dune (2021)")
	time.Sleep(30 * time.Millisecond)
	if got := f.Refreshed(); len(got) != 0 {
		t.Fatalf("refreshed early: %v", got)
	}
	r.Flush(context.Background())
	if got := f.Refreshed(); len(got) != 1 {
		t.Fatalf("Flush sent %v", got)
	}
}

func TestEveryEnabledServerIsTold(t *testing.T) {
	a, b := fake.New("k"), fake.New("k")
	r, _ := refresher(t, time.Hour, fakeServer(a, 1, "A"), fakeServer(b, 2, "B"))
	r.FolderChanged(context.Background(), "/x")
	r.Flush(context.Background())
	if len(a.Refreshed()) != 1 || len(b.Refreshed()) != 1 {
		t.Fatalf("a=%v b=%v", a.Refreshed(), b.Refreshed())
	}
}

func TestAFailingServerRaisesAWarningAndTheOthersAreStillTold(t *testing.T) {
	bad, good := fake.New("k"), fake.New("k")
	bad.FailWith(plugin.Errorf(plugin.CodeUnavailable, "down"))
	r, h := refresher(t, time.Hour,
		imports.MediaServer{InstanceID: 1, Name: "Jelly", PluginID: "jellyfin", Server: bad, Conn: bad.Conn(1)},
		fakeServer(good, 2, "Silo"))
	r.FolderChanged(context.Background(), "/x")
	r.Flush(context.Background())
	is, ok := h.keys()["refresh_failed:jellyfin"]
	if !ok || is.Kind != health.KindRefreshFailed || is.Severity != health.Warning || !is.Dismissible || is.Subject.PluginInstanceID != 1 {
		t.Fatalf("health %+v", h.keys())
	}
	if len(good.Refreshed()) != 1 {
		t.Fatal("the healthy server was not told")
	}
	// the next success clears it
	bad.FailWith(nil)
	r.FolderChanged(context.Background(), "/x")
	r.Flush(context.Background())
	if len(h.keys()) != 0 {
		t.Fatalf("not cleared: %+v", h.keys())
	}
}

func TestAFolderInNoPlexSectionRaisesPerFolder(t *testing.T) {
	f := fake.New("k")
	r, h := refresher(t, time.Hour, imports.MediaServer{InstanceID: 1, Name: "Plex", PluginID: "plex", Server: f, Conn: f.Conn(1)})
	folder := fake.Unplaceable + "/Dune (2021)"
	r.FolderChanged(context.Background(), folder)
	r.Flush(context.Background())
	is, ok := h.keys()["plex_no_section:"+folder]
	if !ok || is.Kind != health.KindPlexNoSection || is.Severity != health.Warning {
		t.Fatalf("health %+v", h.keys())
	}
	if _, bad := h.keys()["refresh_failed:plex"]; bad {
		t.Fatal("a missing section is not a failed refresh")
	}
}
