package acquire_test

import (
	"context"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/library"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	"github.com/hyprsh/kestrel/internal/slot"
)

func TestSearchNowIsStartedByHandSoTheBudgetStopDoesNotApply(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.publish(t, hd1080, time.Hour)
	r.idx.Report(indexer.Limits{Reported: true, APICurrent: 80, APIMax: 100})

	out, err := r.svc.SearchNow(ctx, r.versions[slot.Standard], library.Scope{})

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

	out, err := r.svc.SearchNow(ctx, ver, library.Scope{EpisodeIDs: []int64{eps[1].ID}})

	if err != nil || len(out.Grabbed) != 1 || out.Grabbed[0].ReleaseName != nightEp2 {
		t.Fatalf("Search now of S01E02 = %+v, %v", out, err)
	}
	if got, _ := r.svc.GrabEpisodes(ctx, out.Grabbed[0].ID); len(got) != 1 || got[0] != eps[1].ID {
		t.Errorf("Grab covers %v, want only S01E02", got)
	}
}
