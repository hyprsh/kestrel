package library_test

import (
	"context"
	"github.com/hyprsh/kestrel/internal/slot"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/store/storetest"
)

const hours = time.Hour

func TestNextMissingFollowsTheCadenceFromWantedSince(t *testing.T) {
	since := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	at := func(d time.Duration) time.Time { return since.Add(d) }
	cases := []struct {
		name     string
		searched time.Duration
		next     time.Duration
	}{
		{"at once, the next is a day after Wanted since", 0, 24 * hours},
		{"a day after, the next is day three", 24 * hours, 72 * hours},
		{"a little late for day one is still day three", 25 * hours, 72 * hours},
		{"day three, the next is day seven", 72 * hours, 7 * 24 * hours},
		{"day seven, then weekly", 7 * 24 * hours, 14 * 24 * hours},
		{"late for day seven, still a week after the search", 8 * 24 * hours, 15 * 24 * hours},
		{"weekly goes on until 90 days", 84 * 24 * hours, 91 * 24 * hours},
		{"after 90 days, every 30 days", 91 * 24 * hours, 121 * 24 * hours},
		{"and never gives up", 400 * 24 * hours, 430 * 24 * hours},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got, want := library.NextMissing(since, at(c.searched)), at(c.next); !got.Equal(want) {
				t.Fatalf("NextMissing = %v, want %v", got, want)
			}
		})
	}
}

// clocked is a Library on a clock the test moves.
func clocked(t *testing.T) (*library.Service, *time.Time, *store.Store) {
	t.Helper()
	st, err := store.Open(context.Background(), store.Options{Dir: storetest.Dir(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	clock := new(time.Time)
	*clock = now
	return library.New(st, func() time.Time { return *clock }).WithCountry(func(context.Context) string { return "US" }), clock, st
}

func due(t *testing.T, lib *library.Service, at time.Time) []library.Due {
	t.Helper()
	d, err := lib.DueMissing(context.Background(), at)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func TestAWantedMovieIsSearchedAtOneThreeAndSevenDaysThenWeeklyThenEveryThirtyDays(t *testing.T) {
	ctx := context.Background()
	lib, _, _ := clocked(t)
	id := addPaddington(t, lib)
	vid := mustVersion(t, lib, id)

	// The add makes it due at once (search on add); Wanted since is the add.
	if len(due(t, lib, now)) != 1 {
		t.Fatal("not due on add")
	}
	step := func(at time.Time, wantNext time.Duration) {
		t.Helper()
		if err := lib.MarkMissingSearched(ctx, vid, at, false); err != nil {
			t.Fatal(err)
		}
		next := now.Add(wantNext)
		if len(due(t, lib, next.Add(-time.Minute))) != 0 {
			t.Errorf("searched at %v, still due a minute before %v", at.Sub(now), wantNext)
		}
		if len(due(t, lib, next)) != 1 {
			t.Errorf("searched at %v, not due at %v", at.Sub(now), wantNext)
		}
	}
	step(now, 24*hours)
	step(now.Add(24*hours), 72*hours)
	step(now.Add(72*hours), 7*24*hours)
	step(now.Add(7*24*hours), 14*24*hours)
	step(now.Add(91*24*hours), 121*24*hours)
}

func mustVersion(t *testing.T, lib *library.Service, titleID int64) int64 {
	t.Helper()
	d, err := lib.Get(context.Background(), titleID, library.View{Country: "US", Now: now})
	if err != nil {
		t.Fatal(err)
	}
	return d.Versions[0].ID
}

// A Series Version has a row per season, each counting from the latest Wanted
// since among that season's Wanted episodes; a newly aired episode restarts the
// early cadence of its season's row.
func TestASeasonCountsFromItsLatestWantedEpisodeAndANewlyAiredEpisodeRestartsTheEarlyCadence(t *testing.T) {
	ctx := context.Background()
	lib, _, _ := clocked(t)
	d, _ := show()
	v := metadata.TVDBSeries{ID: 81189, Name: "Breaking Bad", Episodes: []metadata.Episode{
		{ID: 2, Season: 1, Number: 1, Name: "Pilot", Aired: aired(2008, 1, 20)},
		{ID: 3, Season: 1, Number: 2, Name: "Fresh", Aired: aired(2026, 10, 19)}, // airs two days after the add
		{ID: 4, Season: 2, Number: 1, Name: "Seven", Aired: aired(2009, 3, 8)},
	}}
	id, err := lib.AddSeries(ctx, library.AddSeries{
		TMDB: d, TVDB: v, PrimaryLanguage: "en", Monitor: library.MonitorAll, RootFolder: "/tv",
		Versions: []library.VersionSpec{{Slot: slot.Standard, Profile: "hd-primary"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	vid := mustVersion(t, lib, id)
	at := func(day, hour int) time.Time { return time.Date(2026, 10, day, hour, 0, 0, 0, time.UTC) }

	mark := func(when time.Time) {
		t.Helper()
		if err := lib.MarkMissingSearched(ctx, vid, when, false); err != nil {
			t.Fatal(err)
		}
	}
	isDue := func(when time.Time) bool { return len(due(t, lib, when)) == 1 }

	mark(at(17, 12)) // the add: both seasons count from it, so they are due a day later
	if isDue(at(18, 11)) || !isDue(at(18, 12)) {
		t.Fatal("the seasons are not due a day after the add")
	}
	mark(at(18, 12)) // both are scheduled for day three, the 20th at noon

	// The episode of season 1 aired on the 19th, after the last search: season 1
	// restarts the early cadence and is due a day after it aired, ahead of day three.
	if isDue(at(19, 23)) || !isDue(at(20, 0)) {
		t.Fatal("a newly aired episode did not restart the early cadence")
	}
	mark(at(20, 12))
	// Season 1 now counts from the 19th (its latest Wanted episode): day three of
	// that is the 22nd. Season 2 still counts from the add: day seven is the 24th at noon.
	if isDue(at(21, 23)) || !isDue(at(22, 0)) {
		t.Fatal("season 1 is not due on day three of its latest Wanted episode")
	}
	mark(at(22, 0))
	if isDue(at(24, 11)) || !isDue(at(24, 12)) {
		t.Fatal("season 2 is not due on day seven, on its own anchor")
	}
}

func TestAFilledMovieIsDueAnUpgradeSearchEveryThirtyDaysOldestSearchedFirst(t *testing.T) {
	ctx := context.Background()
	lib, _, _ := clocked(t)
	first := addPaddington(t, lib)
	other := paddington()
	other.TMDBID = 2
	second, err := lib.AddMovie(ctx, library.AddMovie{
		Details: other, PrimaryLanguage: "en", RootFolder: "/m", Versions: []library.VersionSpec{{Slot: slot.Standard, Profile: "hd-primary"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	v1, v2 := mustVersion(t, lib, first), mustVersion(t, lib, second)
	upgrades := func(at time.Time, limit int) []library.Due {
		t.Helper()
		d, err := lib.DueUpgrades(ctx, at, limit)
		if err != nil {
			t.Fatal(err)
		}
		return d
	}

	// Wanted Versions are not up for Upgrades.
	if got := upgrades(now.Add(365*24*hours), 0); len(got) != 0 {
		t.Fatalf("Wanted Versions are due Upgrades: %+v", got)
	}
	for i, v := range []int64{v1, v2} {
		if _, err := lib.ReplaceFile(ctx, []int64{first, second}[i], "folder", library.NewFile{VersionID: v, Path: "/m/a.mkv", Size: 1, ReleaseName: "r", Score: 10}); err != nil {
			t.Fatal(err)
		}
	}
	if got := upgrades(now, 0); len(got) != 2 {
		t.Fatalf("filled and never searched: %+v, want both", got)
	}

	if err := lib.MarkUpgradeSearched(ctx, v1, now, false); err != nil {
		t.Fatal(err)
	}
	if err := lib.MarkUpgradeSearched(ctx, v2, now.Add(hours), false); err != nil {
		t.Fatal(err)
	}
	if got := upgrades(now.Add(30*24*hours-time.Minute), 0); len(got) != 0 {
		t.Errorf("due before 30 days: %+v", got)
	}
	got := upgrades(now.Add(31*24*hours), 0)
	if len(got) != 2 || got[0].VersionID != v1 || got[1].VersionID != v2 {
		t.Errorf("due after 30 days = %+v, want the oldest-searched first", got)
	}
	if got := upgrades(now.Add(31*24*hours), 1); len(got) != 1 || got[0].VersionID != v1 {
		t.Errorf("limit 1 = %+v", got)
	}

	// A failed Upgrade search is retried soon.
	if err := lib.MarkUpgradeSearched(ctx, v1, now.Add(31*24*hours), true); err != nil {
		t.Fatal(err)
	}
	if got := upgrades(now.Add(31*24*hours+15*time.Minute), 0); len(got) != 2 {
		t.Errorf("after a failed Upgrade search = %+v", got)
	}
}

func TestAMissingSearchAlsoPostponesTheUpgradeSearchByThirtyDays(t *testing.T) {
	ctx := context.Background()
	lib, _, _ := clocked(t)
	id := addPaddington(t, lib)
	vid := mustVersion(t, lib, id)
	if err := lib.MarkMissingSearched(ctx, vid, now, false); err != nil {
		t.Fatal(err)
	}
	if _, err := lib.ReplaceFile(ctx, id, "folder", library.NewFile{VersionID: vid, Path: "/m/a.mkv", Size: 1, ReleaseName: "r", Score: 10}); err != nil {
		t.Fatal(err)
	}

	if got, _ := lib.DueUpgrades(ctx, now.Add(29*24*hours), 0); len(got) != 0 {
		t.Errorf("a freshly filled Version is searched again at once: %+v", got)
	}
	if got, _ := lib.DueUpgrades(ctx, now.Add(30*24*hours), 0); len(got) != 1 {
		t.Errorf("not due after 30 days: %+v", got)
	}
}

func TestSearchAllWantedMakesEveryWantedVersionDueNowAndLeavesFilledOnesAlone(t *testing.T) {
	ctx := context.Background()
	lib, _, _ := clocked(t)
	wanted := addPaddington(t, lib)
	other := paddington()
	other.TMDBID = 2
	filled, _ := lib.AddMovie(ctx, library.AddMovie{
		Details: other, PrimaryLanguage: "en", RootFolder: "/m", Versions: []library.VersionSpec{{Slot: slot.Standard, Profile: "hd-primary"}},
	})
	wv, fv := mustVersion(t, lib, wanted), mustVersion(t, lib, filled)
	if _, err := lib.ReplaceFile(ctx, filled, "folder", library.NewFile{VersionID: fv, Path: "/m/a.mkv", Size: 1, ReleaseName: "r", Score: 10}); err != nil {
		t.Fatal(err)
	}
	_ = lib.MarkMissingSearched(ctx, wv, now, false)
	if len(due(t, lib, now)) != 0 {
		t.Fatal("still due after a search")
	}

	n, err := lib.SearchAllWanted(ctx)
	if err != nil || n != 1 {
		t.Fatalf("SearchAllWanted = %d, %v, want 1", n, err)
	}
	if got := due(t, lib, now); len(got) != 1 || got[0].VersionID != wv {
		t.Errorf("due = %+v, want the Wanted Version", got)
	}
}

func TestLongMissingListsTheVersionsWantedForMoreThanNinetyDaysMostRecentFirst(t *testing.T) {
	ctx := context.Background()
	lib, clock, _ := clocked(t)
	older := addPaddington(t, lib)
	*clock = now.Add(10 * 24 * hours)
	other := paddington()
	other.TMDBID = 2
	other.Title = "Later"
	newer, _ := lib.AddMovie(ctx, library.AddMovie{
		Details: other, PrimaryLanguage: "en", RootFolder: "/m", Versions: []library.VersionSpec{{Slot: slot.FourK, Profile: "4k-primary"}},
	})

	if got, _ := lib.LongMissing(ctx, library.View{Country: "US", Now: now.Add(89 * 24 * hours)}); len(got) != 0 {
		t.Fatalf("long missing after 89 days: %+v", got)
	}
	got, err := lib.LongMissing(ctx, library.View{Country: "US", Now: now.Add(101 * 24 * hours)})
	if err != nil || len(got) != 2 {
		t.Fatalf("LongMissing = %+v, %v", got, err)
	}
	if got[0].TitleID != newer || got[0].Slot != slot.FourK || got[1].TitleID != older || got[1].Slot != slot.Standard {
		t.Errorf("order/fields = %+v", got)
	}
	if !got[0].WantedSince.Equal(now.Add(10 * 24 * hours)) {
		t.Errorf("wanted since = %v", got[0].WantedSince)
	}
}
