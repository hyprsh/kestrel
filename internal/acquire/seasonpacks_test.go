package acquire_test

import (
	"slices"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/library"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
)

const (
	nightPack3    = "Night.Show.S03.1080p.WEB-DL.H264-GRP"
	nightComplete = "Night.Show.S01-S03.1080p.WEB-DL.H264-GRP"
)

// threeSeasons is Night Show with three aired seasons of two episodes each.
func (r *rig) threeSeasons(t *testing.T) (titleID, versionID int64) {
	t.Helper()
	d, v := nightShow()
	v.Episodes[2].Aired = day(2026, 2, 5)
	next := v.Episodes[2]
	next.ID, next.Number, next.Name, next.Aired = 4, 2, "Daybreak", day(2026, 2, 12)
	v.Episodes = append(v.Episodes, next)
	for i, n := range []int{1, 2} {
		ep := v.Episodes[2]
		ep.ID, ep.Season, ep.Number, ep.Name, ep.Aired = 5+i, 3, n, "Late", day(2026, 3, 5+i)
		v.Episodes = append(v.Episodes, ep)
	}
	id := r.addSeries(t, d, v, library.MonitorAll)
	det, err := r.lib.Get(byPerson(), id, library.View{Country: "US", Now: r.clock.now})
	if err != nil {
		t.Fatal(err)
	}
	return id, det.Versions[0].ID
}

// publishPacks gives the indexer a pack of each season and a complete-series pack.
func (r *rig) publishPacks(t *testing.T) {
	t.Helper()
	r.publishShow(t, nightPack, "1", "")
	r.publishShow(t, nightPack2, "2", "")
	r.publishShow(t, nightPack3, "3", "")
	r.publishShow(t, nightComplete, "", "")
}

func names(res acquire.SearchResult) []string {
	var out []string
	for _, f := range res.Items {
		out = append(out, f.Name)
	}
	slices.Sort(out)
	return out
}

func TestAManualSearchOfAWholeSeriesAsksEachAiredSeasonAndListsEveryPackOnce(t *testing.T) {
	ctx := byPerson()
	r := newRig(t)
	_, ver := r.threeSeasons(t)
	r.publishPacks(t)
	r.publishShow(t, nightEp1, "1", "1")
	// The indexer ranks Season 1 and the complete pack first for a search without a season.
	r.tap.ranked = func(rel indexer.Release) bool { return rel.Season == "1" || rel.Season == "" }

	res, err := r.svc.Releases(ctx, ver, library.Scope{}, true)
	if err != nil {
		t.Fatal(err)
	}

	want := []string{nightEp1, nightPack, nightPack2, nightPack3, nightComplete}
	slices.Sort(want)
	if got := names(res); !slices.Equal(got, want) {
		t.Errorf("listed %v, want %v", got, want)
	}
	if got, want := r.tap.calls(), []string{"", "1", "2", "3"}; !slices.Equal(got, want) {
		t.Errorf("seasons asked %q, want the whole Series then each season %q", got, want)
	}
}

func TestAManualSearchOfAWholeSeriesDoesNotAskSpecialsOrSeasonsNotYetAired(t *testing.T) {
	ctx := byPerson()
	r := newRig(t)
	_, ver := r.nightShow(t, library.MonitorAll) // season 2 airs in 2099
	r.publishShow(t, nightEp1, "1", "1")

	if _, err := r.svc.Releases(ctx, ver, library.Scope{}, true); err != nil {
		t.Fatal(err)
	}
	if got, want := r.tap.calls(), []string{"", "1"}; !slices.Equal(got, want) {
		t.Errorf("seasons asked %q, want %q", got, want)
	}
}

func TestAnIndexerThatIgnoresTheSeasonIsAskedOnceForAWholeSeriesManualSearch(t *testing.T) {
	ctx := byPerson()
	r := newRig(t)
	_, ver := r.threeSeasons(t)
	r.publishPacks(t)
	r.tap.ignoresSeason = true

	// The first search shows the indexer returns the same Releases for two seasons.
	first, err := r.svc.Releases(ctx, ver, library.Scope{}, true)
	if err != nil || len(first.Items) != 4 {
		t.Fatalf("first search = %d items, %v, want the 4 packs once each", len(first.Items), err)
	}
	r.clock.now = r.clock.now.Add(time.Minute)
	before := r.tap.count()

	res, err := r.svc.Releases(ctx, ver, library.Scope{}, true)
	if err != nil || len(res.Items) != 4 {
		t.Fatalf("second search = %d items, %v", len(res.Items), err)
	}
	if n := r.tap.count() - before; n != 1 {
		t.Errorf("%d requests, want the one for the whole Series: the seasons come from its answer", n)
	}
}

func TestASweepAsksASeasonOnItsOwnEvenWhenTheWholeAnswerHoldsOneOfItsEpisodes(t *testing.T) {
	ctx := byPerson()
	r := newRig(t)
	id, ver := r.twoSeasons(t)
	r.publishShow(t, nightPack, "1", "")
	r.publishShow(t, nightS2, "2", "1")
	r.publishShow(t, nightPack2, "2", "")
	// Season 2's pack is not among what the indexer ranks first for the whole Series.
	r.tap.ranked = func(rel indexer.Release) bool { return rel.Season != "2" || rel.Episode != "" }

	out, err := r.svc.SearchWanted(acquire.WithObserver(ctx, &requests{}), id, []int64{ver})
	if err != nil {
		t.Fatal(err)
	}

	if got, want := r.tap.calls(), []string{"", "2"}; !slices.Equal(got, want) {
		t.Errorf("seasons asked %q, want the whole Series and season 2 (season 1's pack was in the whole answer)", got)
	}
	var grabbed []string
	for _, g := range out.Grabbed {
		grabbed = append(grabbed, g.ReleaseName)
	}
	slices.Sort(grabbed)
	if want := []string{nightPack, nightPack2}; !slices.Equal(grabbed, want) {
		t.Errorf("grabbed %v, want both season packs", grabbed)
	}
}

func TestASeasonManualSearchRightAfterTheWholeSeriesOneDoesNotAskTheIndexersAgain(t *testing.T) {
	ctx := byPerson()
	r := newRig(t)
	_, ver := r.threeSeasons(t)
	r.publishPacks(t)

	if _, err := r.svc.Releases(ctx, ver, library.Scope{}, false); err != nil {
		t.Fatal(err)
	}
	asked := r.tap.count()
	r.clock.now = r.clock.now.Add(5 * time.Minute)
	season := 2

	res, err := r.svc.Releases(ctx, ver, library.Scope{Season: &season}, false)
	if err != nil || !res.Cached {
		t.Fatalf("season search = cached %v, %v, want it answered from the whole search", res.Cached, err)
	}
	if got := names(res); !slices.Contains(got, nightPack2) || slices.Contains(got, nightPack) {
		t.Errorf("listed %v, want season 2's pack and none of season 1's", got)
	}
	whole, err := r.svc.Releases(ctx, ver, library.Scope{}, false)
	if err != nil || !whole.Cached || len(whole.Items) != 4 {
		t.Fatalf("whole search again = cached %v, %d items, %v", whole.Cached, len(whole.Items), err)
	}
	if n := r.tap.count(); n != asked {
		t.Errorf("%d requests after the first search, want %d", n, asked)
	}
}

func TestAWholeSeriesManualSearchReusesFreshSeasonAnswersAndAsksOnlyWhatIsMissing(t *testing.T) {
	ctx := byPerson()
	r := newRig(t)
	_, ver := r.threeSeasons(t)
	r.publishPacks(t)
	for _, n := range []int{1, 2, 3} {
		if _, err := r.svc.Releases(ctx, ver, library.Scope{Season: &n}, false); err != nil {
			t.Fatal(err)
		}
	}
	asked := r.tap.count()

	res, err := r.svc.Releases(ctx, ver, library.Scope{}, false)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := r.tap.calls()[asked:], []string{""}; !slices.Equal(got, want) {
		t.Errorf("asked %q, want only the whole Series: the seasons were answered a moment ago", got)
	}
	if len(res.Items) != 4 {
		t.Errorf("listed %v, want the 4 packs once each", names(res))
	}
}

func TestASweepCountsAReleaseTheWholeAndSeasonAnswersShareOnce(t *testing.T) {
	ctx := byPerson()
	r := newRig(t)
	id, ver := r.twoSeasons(t)
	r.publishShow(t, nightS2, "2", "1")
	r.publishShow(t, nightPack, "1", "")
	obs := &seen{}

	if _, err := r.svc.SearchWanted(acquire.WithObserver(ctx, obs), id, []int64{ver}); err != nil {
		t.Fatal(err)
	}
	if got := obs.n; got != 2 {
		t.Errorf("%d Releases seen, want the 2 published, each once", got)
	}
}

// seen sums the Releases a search reports.
type seen struct{ n int }

func (s *seen) Searching(acquire.Target) {}
func (s *seen) Releases(n int)           { s.n += n }
