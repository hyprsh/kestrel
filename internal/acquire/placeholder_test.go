package acquire_test

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/library"
)

// Night Show lists S01E01-E02 and S02E01; it has no season 3.

// placeholderAt is the Placeholder Episode at season and number, if there is one.
func (r *rig) placeholderAt(t *testing.T, id int64, season, number int) (library.Episode, bool) {
	t.Helper()
	eps, err := r.lib.Episodes(context.Background(), id, library.View{Country: "US", Now: r.clock.now})
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range eps {
		if e.Season == season && e.Number == number {
			return e, e.Placeholder
		}
	}
	return library.Episode{}, false
}

func (r *rig) episodeCount(t *testing.T, id int64) int {
	t.Helper()
	eps, err := r.lib.Episodes(context.Background(), id, library.View{Country: "US", Now: r.clock.now})
	if err != nil {
		t.Fatal(err)
	}
	return len(eps)
}

func TestRSSGrabsAnEpisodeJustPastTheLastListedOneAsAPlaceholderEpisode(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	id, _ := r.nightShow(t, library.MonitorAll)
	const name = "Night.Show.S01E03.1080p.WEB-DL.H264-GRP"
	r.publishTV(t, name)

	out, err := r.svc.SyncRSS(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Grabbed) != 1 || out.Grabbed[0].ReleaseName != name {
		t.Fatalf("grabbed = %+v", out.Grabbed)
	}
	p, ok := r.placeholderAt(t, id, 1, 3)
	if !ok || !p.Monitored {
		t.Fatalf("placeholder = %+v, %v", p, ok)
	}
	if got, _ := r.svc.GrabEpisodes(ctx, out.Grabbed[0].ID); len(got) != 1 || got[0] != p.ID {
		t.Errorf("the Grab covers %v, want the placeholder %d", got, p.ID)
	}
	if out, _ = r.svc.SyncRSS(ctx); len(out.Grabbed) != 0 {
		t.Errorf("rerun grabbed %+v", out.Grabbed)
	}
}

func TestTheEpisodesAnActiveGrabIsFetchingAreTheTitlesUntilTheGrabEnds(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	id, _ := r.nightShow(t, library.MonitorAll)
	r.publishTV(t, "Night.Show.S01E03.1080p.WEB-DL.H264-GRP")
	out, err := r.svc.SyncRSS(ctx)
	if err != nil || len(out.Grabbed) != 1 {
		t.Fatalf("RSS = %+v, %v", out, err)
	}
	p, _ := r.placeholderAt(t, id, 1, 3)

	if got, err := r.svc.FetchingEpisodes(ctx, id); err != nil || len(got) != 1 || !got[p.ID] {
		t.Fatalf("fetching = %v, %v; want the placeholder %d", got, err, p.ID)
	}
	if got, _ := r.svc.FetchingEpisodes(ctx, r.titleID); len(got) != 0 {
		t.Errorf("another Title's = %v", got)
	}
	if _, err := r.svc.Cancel(ctx, out.Grabbed[0].ID, false); err != nil {
		t.Fatal(err)
	}
	if got, _ := r.svc.FetchingEpisodes(ctx, id); len(got) != 0 {
		t.Errorf("fetching after the cancel = %v", got)
	}
}

func TestRSSDoesNotGrabUnlistedEpisodesThatDoNotQualify(t *testing.T) {
	for _, tc := range []struct {
		name string
		mode library.Monitor
		prep func(t *testing.T, r *rig, id int64)
	}{
		{"Night.Show.S01E05.1080p.WEB-DL.H264-GRP", library.MonitorAll, nil},
		{"Night.Show.S03E01.1080p.WEB-DL.H264-GRP", library.MonitorAll, nil},
		{"Night.Show.S01E03.1080p.WEB-DL.H264-GRP", library.MonitorNone, nil},
		{"Night.Show.S01E03.1080p.WEB-DL.H264-GRP", library.MonitorAll, func(t *testing.T, r *rig, id int64) {
			if err := r.lib.SetSeasonMonitored(context.Background(), id, 1, false); err != nil {
				t.Fatal(err)
			}
		}},
	} {
		t.Run(tc.name+" "+string(tc.mode), func(t *testing.T) {
			r := newRig(t)
			id, _ := r.nightShow(t, tc.mode)
			if tc.prep != nil {
				tc.prep(t, r, id)
			}
			r.publishTV(t, tc.name)
			out, err := r.svc.SyncRSS(context.Background())
			if err != nil || len(out.Grabbed) != 0 {
				t.Fatalf("out = %+v, %v", out, err)
			}
			if n := r.episodeCount(t, id); n != 3 {
				t.Errorf("%d episodes, want the 3 listed", n)
			}
		})
	}
}

func TestARSSReleaseAlsoNamingAnUnqualifiedEpisodeTakesOnlyItsListedOnes(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	id, _ := r.nightShow(t, library.MonitorAll)
	r.publishTV(t, "Night.Show.S01E02E03E04E05.1080p.WEB-DL.H264-GRP")

	out, err := r.svc.SyncRSS(ctx)
	if err != nil || len(out.Grabbed) != 1 {
		t.Fatalf("out = %+v, %v", out, err)
	}
	if n := r.episodeCount(t, id); n != 3 {
		t.Errorf("%d episodes, want no placeholder", n)
	}
	if got, _ := r.svc.GrabEpisodes(ctx, out.Grabbed[0].ID); len(got) != 1 {
		t.Errorf("the Grab covers %v, want S01E02 only", got)
	}
}

func TestTheWantedSweepGrabsAQualifyingUnlistedEpisodeOfTheSeasonItSearches(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	id, ver := r.nightShow(t, library.MonitorAll)
	r.publishShow(t, nightEp1, "1", "1")
	const name = "Night.Show.S01E03.1080p.WEB-DL.H264-GRP"
	r.publishShow(t, name, "1", "3")

	out, err := r.svc.SearchWanted(ctx, id, []int64{ver})
	if err != nil {
		t.Fatal(err)
	}
	var g acquire.Grab
	for _, x := range out.Grabbed {
		if x.ReleaseName == name {
			g = x
		}
	}
	p, ok := r.placeholderAt(t, id, 1, 3)
	if g.ID == 0 || !ok {
		t.Fatalf("grabbed %+v, placeholder %v", out.Grabbed, ok)
	}
	if got, _ := r.svc.GrabEpisodes(ctx, g.ID); len(got) != 1 || got[0] != p.ID {
		t.Errorf("the Grab covers %v, want the placeholder %d", got, p.ID)
	}
}

func TestAManualSearchMarksUnlistedEpisodesAndAnOverrideAddsThePlaceholderEpisode(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	id, ver := r.nightShow(t, library.MonitorAll)
	const (
		next   = "Night.Show.S01E03.1080p.WEB-DL.H264-GRP"
		beyond = "Night.Show.S01E05.1080p.WEB-DL.H264-GRP"
		season = "Night.Show.S03E01.1080p.WEB-DL.H264-GRP"
	)
	r.publishShow(t, next, "1", "3")
	r.publishShow(t, beyond, "1", "5")
	r.publishShow(t, season, "3", "1")

	res, err := r.svc.Search(ctx, ver)
	if err != nil {
		t.Fatal(err)
	}
	if f := r.found(t, res, next); len(f.Rejections) != 0 {
		t.Errorf("S01E03 rejections = %+v", f.Rejections)
	}
	if f := r.found(t, res, beyond); len(f.Rejections) != 1 || f.Rejections[0] != (acquire.Reason{Code: acquire.RejectEpisodeNotListed, Overridable: true}) {
		t.Errorf("S01E05 rejections = %+v", f.Rejections)
	}
	if f := r.found(t, res, season); len(f.Rejections) != 1 || f.Rejections[0] != (acquire.Reason{Code: acquire.RejectSeasonNotListed, Overridable: false}) {
		t.Errorf("S03E01 rejections = %+v", f.Rejections)
	}

	// Without override the beyond-the-limit Release is refused; with it, it adds S01E05.
	var rej *acquire.RejectedError
	if _, err := r.svc.Grab(ctx, ver, r.found(t, res, beyond).ID, false); !errors.As(err, &rej) || rej.NotOverridable() {
		t.Fatalf("grab without override: %v", err)
	}
	g, err := r.svc.Grab(ctx, ver, r.found(t, res, beyond).ID, true)
	if err != nil {
		t.Fatal(err)
	}
	p, ok := r.placeholderAt(t, id, 1, 5)
	if !ok {
		t.Fatal("no Placeholder Episode S01E05")
	}
	if got, _ := r.svc.GrabEpisodes(ctx, g.ID); !slices.Equal(got, []int64{p.ID}) || !g.Overridden {
		t.Errorf("the Grab covers %v (overridden %v)", got, g.Overridden)
	}

	// A season TheTVDB does not list is refused even with override.
	if _, err := r.svc.Grab(ctx, ver, r.found(t, res, season).ID, true); !errors.As(err, &rej) || !rej.NotOverridable() {
		t.Fatalf("grab of an unlisted season: %v", err)
	}
	if _, ok := r.placeholderAt(t, id, 3, 1); ok {
		t.Error("added an episode to an unlisted season")
	}

	// A qualifying one needs no override and adds S01E03.
	g, err = r.svc.Grab(ctx, ver, r.found(t, res, next).ID, false)
	if err != nil {
		t.Fatal(err)
	}
	if p, ok := r.placeholderAt(t, id, 1, 3); !ok || g.Overridden {
		t.Errorf("placeholder %v, overridden %v", p, g.Overridden)
	}
}

func TestAManualSearchMarksAnUnlistedEpisodeOfAnUnmonitoredSeasonAndAnOverrideGrabsIt(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	id, ver := r.nightShow(t, library.MonitorAll)
	if err := r.lib.SetSeasonMonitored(ctx, id, 1, false); err != nil {
		t.Fatal(err)
	}
	const next = "Night.Show.S01E03.1080p.WEB-DL.H264-GRP"
	r.publishShow(t, next, "1", "3")

	res, err := r.svc.Search(ctx, ver)
	if err != nil {
		t.Fatal(err)
	}
	f := r.found(t, res, next)
	if len(f.Rejections) != 1 || f.Rejections[0] != (acquire.Reason{Code: acquire.RejectEpisodeNotListed, Overridable: true}) {
		t.Fatalf("S01E03 rejections = %+v", f.Rejections)
	}
	g, err := r.svc.Grab(ctx, ver, f.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	p, ok := r.placeholderAt(t, id, 1, 3)
	if !ok {
		t.Fatal("no Placeholder Episode S01E03")
	}
	if got, _ := r.svc.GrabEpisodes(ctx, g.ID); !slices.Equal(got, []int64{p.ID}) {
		t.Errorf("the Grab covers %v, want the placeholder %d", got, p.ID)
	}
}
