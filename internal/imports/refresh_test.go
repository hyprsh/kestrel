package imports_test

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/health"
	"github.com/hyprsh/kestrel/internal/imports"
	"github.com/hyprsh/kestrel/internal/plugin"
	mediaserver "github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1"
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
	is, ok := h.keys()["refresh_failed:1"]
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

// stubChecks keeps the last check observed of each instance: "" for a good one,
// else the error's code.
type stubChecks struct {
	mu   sync.Mutex
	last map[int64]string
}

func (c *stubChecks) Observe(_ context.Context, id int64, err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.last == nil {
		c.last = map[int64]string{}
	}
	c.last[id] = ""
	if err != nil {
		c.last[id] = string(plugin.AsError(err).Code)
	}
}

func TestEachRefreshIsTheServersLastCheck(t *testing.T) {
	bad, good := fake.New("k"), fake.New("k")
	bad.FailWith(plugin.Errorf(plugin.CodeUnavailable, "down"))
	checks := &stubChecks{}
	r := imports.NewRefresher(imports.RefresherDeps{
		Servers: stubServers{fakeServer(bad, 1, "Jelly"), fakeServer(good, 2, "Silo")}, Checks: checks, Delay: time.Hour,
	})
	t.Cleanup(r.Close)

	r.FolderChanged(context.Background(), "/x")
	r.Flush(context.Background())

	checks.mu.Lock()
	defer checks.mu.Unlock()
	if got, ok := checks.last[1]; !ok || got != "unavailable" {
		t.Errorf("Jelly's last check = %q (%v), want unavailable", got, ok)
	}
	if got, ok := checks.last[2]; !ok || got != "" {
		t.Errorf("Silo's last check = %q (%v), want a good one", got, ok)
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
	if _, bad := h.keys()["refresh_failed:1"]; bad {
		t.Fatal("a missing section is not a failed refresh")
	}
}

// blockingServer holds each Refresh until its context ends, like a media server
// that does not answer.
type blockingServer struct {
	*fake.Server
	started chan struct{}
	once    sync.Once
	ended   atomic.Bool
}

func (b *blockingServer) Refresh(ctx context.Context, _ plugin.Connection, _ []mediaserver.Change) error {
	b.once.Do(func() { close(b.started) })
	<-ctx.Done()
	b.ended.Store(true)
	return ctx.Err()
}

func TestCloseCutsOffARefreshBeingSentAndWaitsForIt(t *testing.T) {
	b := &blockingServer{Server: fake.New("k"), started: make(chan struct{})}
	r, h := refresher(t, time.Millisecond, imports.MediaServer{InstanceID: 1, Name: "Plex", PluginID: "plex", Server: b, Conn: b.Conn(1)})
	r.FolderChanged(context.Background(), "/x")
	select {
	case <-b.started:
	case <-time.After(3 * time.Second):
		t.Fatal("the refresh was never sent")
	}

	closed := make(chan struct{})
	go func() { r.Close(); close(closed) }()
	select {
	case <-closed:
	case <-time.After(3 * time.Second):
		t.Fatal("Close did not return: the refresh being sent was not cut off")
	}
	if !b.ended.Load() {
		t.Fatal("Close returned while a refresh was still being sent")
	}
	if len(h.keys()) != 0 {
		t.Fatalf("a refresh cut off by Close is not a failing server: %+v", h.keys())
	}
}
