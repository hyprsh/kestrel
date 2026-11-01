package acquire_test

import (
	"context"
	"errors"
	"github.com/hyprsh/kestrel/internal/slot"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
)

// fill gives the Movie's Standard Version a file of the given Score.
func (r *rig) fill(t *testing.T, score int) {
	t.Helper()
	if _, err := r.lib.ReplaceFile(context.Background(), r.titleID, "Paddington (2014)", library.NewFile{
		VersionID: r.versions[slot.Standard], Path: "/m/Paddington.mkv", Size: 1, ReleaseName: "Paddington.2014.720p", Score: score,
	}); err != nil {
		t.Fatal(err)
	}
}

func TestSearchUpgradesGrabsAReleaseThatBeatsTheHeldFileAsAnUpgrade(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.fill(t, -100000)
	r.publish(t, hd1080, time.Hour)

	out, err := r.svc.SearchUpgrades(ctx, r.titleID, r.wanted(t, slot.Standard))
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

	out, err := r.svc.SearchUpgrades(ctx, r.titleID, r.wanted(t, slot.Standard))

	if err != nil || len(out.Searched) != 1 || len(out.Grabbed) != 0 {
		t.Fatalf("outcome = %+v, %v, want searched with no Grab", out, err)
	}
}

func TestSearchUpgradesLeavesWantedVersionsAloneAndSearchWantedLeavesFilledOnesAlone(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.publish(t, hd1080, time.Hour)

	out, err := r.svc.SearchUpgrades(ctx, r.titleID, r.wanted(t, slot.Standard))
	if err != nil || len(out.Searched) != 0 || len(out.Grabbed) != 0 {
		t.Fatalf("upgrade search of a Wanted Version = %+v, %v", out, err)
	}

	r.fill(t, -100000)
	out, err = r.svc.SearchWanted(ctx, r.titleID, r.wanted(t, slot.Standard))
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

func TestASearchOfAFilledMovieCoversItAsFilledWithTheHeldFilesScore(t *testing.T) {
	r := newRig(t)
	r.publish(t, hd1080, time.Hour)

	res, err := r.svc.Search(context.Background(), r.versions[slot.Standard])
	if err != nil {
		t.Fatal(err)
	}
	if got := r.found(t, res, hd1080).Covers; len(got) != 1 || !got[0].Whole || got[0].State != acquire.CoverWanted || res.Wanted != 1 {
		t.Errorf("a Wanted Movie: covers %+v, wanted %d", got, res.Wanted)
	}

	r.fill(t, 120)
	res, err = r.svc.Search(context.Background(), r.versions[slot.Standard])
	if err != nil {
		t.Fatal(err)
	}
	got := r.found(t, res, hd1080).Covers
	if len(got) != 1 || got[0].State != acquire.CoverFilled || got[0].FileScore == nil || *got[0].FileScore != 120 || res.Wanted != 0 {
		t.Errorf("a Filled Movie: covers %+v, wanted %d", got, res.Wanted)
	}
}

// atCutoff gives the Standard Profile a cutoff at WEBDL-1080p and an Upgrade-until Score.
func (r *rig) atCutoff(t *testing.T, until int) {
	t.Helper()
	ov := scoring.Overlay{UpgradeUntil: &until, Movies: scoring.KindOverlay{Cutoff: "WEBDL-1080p"}}
	if _, err := r.deps.Profiles.(*profiles.Service).Patch(context.Background(), "hd-primary", profiles.Patch{Overlay: &ov}); err != nil {
		t.Fatal(err)
	}
}

// fillQuality is fill with a stored parse that says the file is of the quality.
func (r *rig) fillQuality(t *testing.T, score int, quality string) {
	t.Helper()
	parsed := `{"quality":{"quality":{"name":"` + quality + `"}}}`
	if _, err := r.lib.ReplaceFile(context.Background(), r.titleID, "Paddington (2014)", library.NewFile{
		VersionID: r.versions[slot.Standard], Path: "/m/Paddington.mkv", Size: 1, ReleaseName: "Paddington.2014.1080p", Score: score, ParsedRelease: parsed,
	}); err != nil {
		t.Fatal(err)
	}
}

func TestSearchUpgradesStopsForAFileAtItsProfilesCutoffButStillCountsItAsSearched(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.atCutoff(t, -100000)
	r.fillQuality(t, -100000, "WEBDL-1080p")
	r.publish(t, hd1080, time.Hour)

	out, err := r.svc.SearchUpgrades(ctx, r.titleID, r.wanted(t, slot.Standard))
	if err != nil {
		t.Fatal(err)
	}

	if len(out.Searched) != 1 || len(out.Grabbed) != 0 {
		t.Fatalf("outcome = %+v, want searched (so it is not due again) and nothing grabbed", out)
	}
}

func TestSearchUpgradesGoesOnBelowTheCutoffScoreOrQuality(t *testing.T) {
	ctx := context.Background()
	for name, setup := range map[string]func(r *rig){
		"the Score is short":              func(r *rig) { r.atCutoff(t, -99999); r.fillQuality(t, -100000, "WEBDL-1080p") },
		"the quality is below the cutoff": func(r *rig) { r.atCutoff(t, -100000); r.fillQuality(t, -100000, "WEBRip-1080p") },
	} {
		t.Run(name, func(t *testing.T) {
			r := newRig(t)
			setup(r)
			r.publish(t, hd1080, time.Hour)
			out, err := r.svc.SearchUpgrades(ctx, r.titleID, r.wanted(t, slot.Standard))
			if err != nil || len(out.Grabbed) != 1 || !out.Grabbed[0].IsUpgrade {
				t.Fatalf("outcome = %+v, %v, want an Upgrade", out, err)
			}
		})
	}
}

func (r *rig) sizeLimit(t *testing.T, min, max int64) {
	t.Helper()
	ov := scoring.Overlay{MovieSize: scoring.SizeLimit{Min: min, Max: max}}
	if _, err := r.deps.Profiles.(*profiles.Service).Patch(context.Background(), "hd-primary", profiles.Patch{Overlay: &ov}); err != nil {
		t.Fatal(err)
	}
}

func TestAReleaseOutsideTheProfilesSizeLimitIsRejectedForItButCanBeGrabbedAnyway(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.sizeLimit(t, 1<<30, 5<<30) // the published Release is 8 GB
	r.publish(t, hd1080, time.Hour)

	res, err := r.svc.Search(ctx, r.versions[slot.Standard])
	if err != nil {
		t.Fatal(err)
	}
	f := r.found(t, res, hd1080)
	if len(f.Rejections) != 1 || f.Rejections[0].Code != scoring.RejectSize || !f.Rejections[0].Overridable {
		t.Fatalf("rejections = %+v, want an overridable size rejection", f.Rejections)
	}
	if f.PerEpisode || f.SizeLimit.Max != 5<<30 || f.SizeLimit.Min != 1<<30 {
		t.Errorf("size limit = %+v per episode %v", f.SizeLimit, f.PerEpisode)
	}

	// The sweep leaves it alone, the user's Grab needs the override.
	out, err := r.svc.SearchWanted(ctx, r.titleID, r.wanted(t, slot.Standard))
	if err != nil || len(out.Grabbed) != 0 {
		t.Fatalf("SearchWanted grabbed %+v, %v", out.Grabbed, err)
	}
	var rej *acquire.RejectedError
	if _, err := r.svc.Grab(ctx, r.versions[slot.Standard], f.ID, false); !errors.As(err, &rej) || rej.NotOverridable() {
		t.Fatalf("Grab without override = %v, want an overridable rejection", err)
	}
	if g, err := r.svc.Grab(ctx, r.versions[slot.Standard], f.ID, true); err != nil || !g.Overridden {
		t.Fatalf("Grab anyway = %+v, %v", g, err)
	}
}

func TestAReleaseWithinTheSizeLimitIsGrabbedAsUsual(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.sizeLimit(t, 1<<30, 10<<30)
	r.publish(t, hd1080, time.Hour)
	out, err := r.svc.SearchWanted(ctx, r.titleID, r.wanted(t, slot.Standard))
	if err != nil || len(out.Grabbed) != 1 {
		t.Fatalf("outcome = %+v, %v", out, err)
	}
}
