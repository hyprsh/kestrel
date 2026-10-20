package acquire_test

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/indexers"
	"github.com/hyprsh/kestrel/internal/library"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	"github.com/hyprsh/kestrel/internal/slot"
)

// hangingIndexers answer no search until its context ends, and remember that it did.
type hangingIndexers struct {
	acquire.Indexers
	started   chan struct{}
	cancelled atomic.Bool
}

func (h *hangingIndexers) Search(ctx context.Context, _ indexers.Query) indexers.Result {
	close(h.started)
	<-ctx.Done()
	h.cancelled.Store(true)
	return indexers.Result{}
}

func TestStoppingTheSearchesCancelsASearchNowAndWaitsForIt(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	hang := &hangingIndexers{Indexers: r.deps.Indexers, started: make(chan struct{})}
	deps := r.deps
	deps.Indexers = hang
	svc, err := acquire.New(deps)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.StartSearch(ctx, r.versions[slot.Standard], library.Scope{}); err != nil {
		t.Fatal(err)
	}
	<-hang.started

	stopped := make(chan struct{})
	go func() { svc.StopSearches(); close(stopped) }()

	select {
	case <-stopped:
	case <-time.After(5 * time.Second):
		t.Fatal("StopSearches did not return: the running search was not cancelled")
	}
	if !hang.cancelled.Load() {
		t.Error("StopSearches returned before the running search ended")
	}
	if err := svc.StartSearch(ctx, r.versions[slot.Standard], library.Scope{}); err != nil {
		t.Errorf("a Search now after the stop = %v, want it accepted and not run", err)
	}
}

func TestSearchNowIsStartedByHandSoTheBudgetStopDoesNotApply(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.publish(t, hd1080, time.Hour)
	r.idx.Report(indexer.Limits{Reported: true, APICurrent: 80, APIMax: 100})

	out, err := acquire.SearchNow(r.svc, ctx, r.versions[slot.Standard], library.Scope{})

	if err != nil || len(out.Searched) != 1 || len(out.Grabbed) != 1 {
		t.Fatalf("Search now at 80%% = %+v, %v; only sweeps stop there", out, err)
	}
}

func TestSearchNowOfAnEpisodeGrabsOnlyThatEpisode(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	id, ver := r.nightShow(t, library.MonitorAll)
	r.publishShow(t, nightEp1, "1", "1")
	r.publishShow(t, nightEp2, "1", "2")
	eps, _ := r.lib.Episodes(ctx, id, library.View{Country: "US", Now: r.clock.now})

	out, err := acquire.SearchNow(r.svc, ctx, ver, library.Scope{EpisodeIDs: []int64{eps[1].ID}})

	if err != nil || len(out.Grabbed) != 1 || out.Grabbed[0].ReleaseName != nightEp2 {
		t.Fatalf("Search now of S01E02 = %+v, %v", out, err)
	}
	if got, _ := r.svc.GrabEpisodes(ctx, out.Grabbed[0].ID); len(got) != 1 || got[0] != eps[1].ID {
		t.Errorf("Grab covers %v, want only S01E02", got)
	}
}
