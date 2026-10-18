package acquire_test

import (
	"context"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/resolution"
)

// fill gives the Movie's HD Version a file of the given Score.
func (r *rig) fill(t *testing.T, score int) {
	t.Helper()
	if _, err := r.lib.ReplaceFile(context.Background(), r.titleID, "Paddington (2014)", library.NewFile{
		VersionID: r.versions[resolution.HD], Path: "/m/Paddington.mkv", Size: 1, ReleaseName: "Paddington.2014.720p", Score: score,
	}); err != nil {
		t.Fatal(err)
	}
}

func TestSearchUpgradesGrabsAReleaseThatBeatsTheHeldFileAsAnUpgrade(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.fill(t, -100000)
	r.publish(t, hd1080, time.Hour)

	out, err := r.svc.SearchUpgrades(ctx, r.titleID, r.wanted(t, resolution.HD))
	if err != nil {
		t.Fatal(err)
	}

	if len(out.Searched) != 1 || len(out.Grabbed) != 1 || !out.Grabbed[0].IsUpgrade || out.Grabbed[0].ReleaseName != hd1080 {
		t.Fatalf("outcome = %+v, want the Release grabbed as an Upgrade", out)
	}
}

func TestSearchUpgradesGrabsNothingThatDoesNotBeatTheHeldFileButCountsAsSearched(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.fill(t, 1000000)
	r.publish(t, hd1080, time.Hour)

	out, err := r.svc.SearchUpgrades(ctx, r.titleID, r.wanted(t, resolution.HD))

	if err != nil || len(out.Searched) != 1 || len(out.Grabbed) != 0 {
		t.Fatalf("outcome = %+v, %v, want searched with no Grab", out, err)
	}
}

func TestSearchUpgradesLeavesWantedVersionsAloneAndSearchWantedLeavesFilledOnesAlone(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.publish(t, hd1080, time.Hour)

	out, err := r.svc.SearchUpgrades(ctx, r.titleID, r.wanted(t, resolution.HD))
	if err != nil || len(out.Searched) != 0 || len(out.Grabbed) != 0 {
		t.Fatalf("upgrade search of a Wanted Version = %+v, %v", out, err)
	}

	r.fill(t, -100000)
	out, err = r.svc.SearchWanted(ctx, r.titleID, r.wanted(t, resolution.HD))
	if err != nil || len(out.Searched) != 0 || len(out.Grabbed) != 0 {
		t.Fatalf("missing search of a filled Version = %+v, %v", out, err)
	}
}

func TestSearchUpgradesOfAFilledSeriesVersionUpgradesTheEpisodesTheReleaseBeats(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	id, ver := r.nightShow(t, library.MonitorAll)
	eps, err := r.lib.Episodes(ctx, id, library.View{Country: "US", Now: r.clock.now})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := r.lib.ReplaceEpisodeFile(ctx, id, "Night Show (2024)", library.NewFile{VersionID: ver, Path: "/tv/s01.mkv", Size: 1, ReleaseName: "old", Score: -100000}, []int64{eps[0].ID, eps[1].ID}); err != nil {
		t.Fatal(err)
	}
	r.publishShow(t, nightEp1, "1", "1")

	out, err := r.svc.SearchUpgrades(ctx, id, []int64{ver})
	if err != nil {
		t.Fatal(err)
	}

	if len(out.Searched) != 1 || len(out.Grabbed) != 1 || !out.Grabbed[0].IsUpgrade || out.Grabbed[0].ReleaseName != nightEp1 {
		t.Fatalf("outcome = %+v", out)
	}
	if got, _ := r.svc.GrabEpisodes(ctx, out.Grabbed[0].ID); len(got) != 1 || got[0] != eps[0].ID {
		t.Errorf("the Upgrade covers %v, want only the first episode", got)
	}
}
