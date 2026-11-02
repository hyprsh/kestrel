package acquire_test

import (
	"context"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/slot"
)

// fillFirst gives the first episode of the night show a file of the given Score, leaving the second one Wanted.
func (r *rig) fillFirst(t *testing.T, score int) (ver int64, eps []library.Episode) {
	t.Helper()
	ctx := context.Background()
	id, ver := r.nightShow(t, library.MonitorAll)
	eps, err := r.lib.Episodes(ctx, id, library.View{Country: "US", Now: r.clock.now})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := r.lib.ReplaceEpisodeFile(ctx, id, "Night Show (2024)", library.NewFile{VersionID: ver, Path: "/tv/s01e01.mkv", Size: 1, ReleaseName: "old", Score: score}, []int64{eps[0].ID}); err != nil {
		t.Fatal(err)
	}
	return ver, eps
}

func TestUpgradeSearchNowGrabsABetterReleaseForAFilledEpisodeOfAVersionThatIsStillWanted(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	ver, eps := r.fillFirst(t, -100000)
	r.publishShow(t, nightEp1, "1", "1")
	r.publishShow(t, nightEp2, "1", "2")

	out, err := acquire.SearchUpgradeNow(r.svc, ctx, ver, library.Scope{EpisodeIDs: []int64{eps[0].ID}})

	if err != nil || len(out.Grabbed) != 1 || !out.Grabbed[0].IsUpgrade || out.Grabbed[0].ReleaseName != nightEp1 {
		t.Fatalf("Upgrade search of S01E01 = %+v, %v, want the better Release grabbed as an Upgrade", out, err)
	}
	if got, _ := r.svc.GrabEpisodes(ctx, out.Grabbed[0].ID); len(got) != 1 || got[0] != eps[0].ID {
		t.Errorf("the Upgrade covers %v, want only S01E01, not the Wanted S01E02", got)
	}
}

func TestUpgradeSearchNowGrabsNothingThatDoesNotBeatTheHeldFile(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	ver, eps := r.fillFirst(t, 1000000)
	r.publishShow(t, nightEp1, "1", "1")

	out, err := acquire.SearchUpgradeNow(r.svc, ctx, ver, library.Scope{EpisodeIDs: []int64{eps[0].ID}})

	if err != nil || len(out.Grabbed) != 0 || len(out.Searched) != 1 {
		t.Fatalf("Upgrade search with only equal or worse Releases = %+v, %v, want searched and nothing grabbed", out, err)
	}
}

func TestUpgradeSearchNowLeavesAWantedEpisodeAlone(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	ver, eps := r.fillFirst(t, -100000)
	r.publishShow(t, nightEp2, "1", "2")

	out, err := acquire.SearchUpgradeNow(r.svc, ctx, ver, library.Scope{EpisodeIDs: []int64{eps[1].ID}})

	if err != nil || len(out.Grabbed) != 0 {
		t.Fatalf("Upgrade search of a Wanted episode = %+v, %v, want nothing grabbed", out, err)
	}
}

func TestAMovieAtItsCutoffHasNothingToUpgrade(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.atCutoff(t, -100000)
	r.fillQuality(t, -100000, "WEBDL-1080p")
	r.publish(t, hd1080, time.Hour)
	ver := r.versions[slot.Standard]

	if can, err := acquire.UpgradeSearchable(r.svc, ctx, r.titleID, ver, slot.Standard, library.Scope{}); err != nil || can {
		t.Errorf("a Movie at its Cutoff: upgradable = %v, %v, want false", can, err)
	}
	if started, err := r.svc.StartUpgradeSearch(ctx, ver, library.Scope{}); err != nil || started {
		t.Errorf("StartUpgradeSearch at the Cutoff = %v, %v, want not started", started, err)
	}

	r.fill(t, -100000) // below the Cutoff again
	if can, err := acquire.UpgradeSearchable(r.svc, ctx, r.titleID, ver, slot.Standard, library.Scope{}); err != nil || !can {
		t.Errorf("a Movie below its Cutoff: upgradable = %v, %v, want true", can, err)
	}
}
