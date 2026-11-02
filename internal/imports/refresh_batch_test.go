package imports_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/imports"
	"github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1/fake"
)

func TestAThousandFoldersAreSentInBatchesWithFewCallsInFlight(t *testing.T) {
	f := fake.New("k")
	f.HoldCalls(2 * time.Millisecond)
	h := &stubHealth{}
	r := imports.NewRefresher(imports.RefresherDeps{
		Servers: stubServers{fakeServer(f, 1, "Silo")}, Health: h, Delay: 20 * time.Millisecond, Batch: 50, InFlight: 3,
	})
	t.Cleanup(r.Close)
	for i := range 1000 {
		r.FolderChanged(context.Background(), fmt.Sprintf("/data/media/movies/Movie %d (2020)", i))
	}
	waitFor(t, func() bool { return len(f.Refreshed()) == 1000 })
	calls := f.Calls()
	if len(calls) != 20 {
		t.Fatalf("calls %v, want 20 batches of 50", calls)
	}
	if got := f.MaxInFlight(); got > 3 || got < 1 {
		t.Fatalf("max in flight %d, want at most 3", got)
	}
	if len(h.keys()) != 0 {
		t.Fatalf("raised %v", h.keys())
	}
}

func TestARateLimitedServerIsRetriedUntilItHasHeardEveryFolder(t *testing.T) {
	f := fake.New("k")
	f.RateLimit(5, 0)
	h := &stubHealth{}
	r := imports.NewRefresher(imports.RefresherDeps{
		Servers: stubServers{fakeServer(f, 1, "Silo")}, Health: h, Delay: 10 * time.Millisecond, Batch: 10, InFlight: 2,
		RetryBase: time.Millisecond, RetryMax: 5 * time.Millisecond,
	})
	t.Cleanup(r.Close)
	for i := range 100 {
		r.FolderChanged(context.Background(), fmt.Sprintf("/data/media/movies/Movie %d (2020)", i))
	}
	waitFor(t, func() bool { return len(f.Refreshed()) == 100 })
	if len(h.keys()) != 0 {
		t.Fatalf("a rate limit raised %v", h.keys())
	}
}

func TestARetryAfterHintIsHonoured(t *testing.T) {
	f := fake.New("k")
	f.RateLimit(1, 80*time.Millisecond)
	r := imports.NewRefresher(imports.RefresherDeps{
		Servers: stubServers{fakeServer(f, 1, "Silo")}, Delay: 5 * time.Millisecond, RetryBase: time.Millisecond,
	})
	t.Cleanup(r.Close)
	start := time.Now()
	r.FolderChanged(context.Background(), "/data/media/movies/Dune (2021)")
	waitFor(t, func() bool { return len(f.Refreshed()) == 1 })
	if since := time.Since(start); since < 80*time.Millisecond {
		t.Fatalf("retried after %s, before the 80ms hint", since)
	}
}
