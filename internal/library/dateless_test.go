package library_test

import (
	"context"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/slot"
)

// addDateless adds a Movie TMDB lists with no release date anywhere.
func addDateless(t *testing.T, lib *library.Service) int64 {
	t.Helper()
	d := paddington()
	d.TMDBID, d.IMDbID, d.Title, d.OriginalTitle, d.Year = 9999, "tt9999999", "Paddington 4", "Paddington 4", 2027
	d.ReleaseDates, d.Translations, d.Aliases = nil, nil, nil
	id, err := lib.AddMovie(context.Background(), library.AddMovie{
		Details: d, PrimaryLanguage: "en", RootFolder: "/m", Versions: []library.VersionSpec{{Slot: slot.Standard, Profile: "hd-primary"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestAMovieWithNoReleaseDateIsWantedOnceAReleaseForItHasBeenSeen(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	id := addDateless(t, lib)
	view := library.View{Country: "DE", Now: now}

	d, err := lib.Get(ctx, id, view)
	if err != nil {
		t.Fatal(err)
	}
	if v := d.Versions[0]; v.State != library.Unreleased {
		t.Fatalf("before a Release is seen = %v", v.State)
	}

	seen := now.Add(48 * time.Hour)
	if err := lib.MarkReleaseSeen(ctx, id, seen); err != nil {
		t.Fatal(err)
	}
	// A second sighting does not move it.
	if err := lib.MarkReleaseSeen(ctx, id, seen.Add(24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	later := library.View{Country: "DE", Now: seen.Add(time.Hour)}
	d, err = lib.Get(ctx, id, later)
	if err != nil {
		t.Fatal(err)
	}
	if v := d.Versions[0]; v.State != library.Wanted || v.WantedSince == nil || !v.WantedSince.Equal(seen) || v.LongMissing {
		t.Errorf("after a Release was seen = %+v", v)
	}
	rows, err := lib.List(ctx, later, library.Filter{Wanted: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].Slots[slot.Standard].State != library.Wanted {
		t.Errorf("Wanted list = %+v", rows)
	}

	// Long Missing counts from the sighting, not from the add.
	long := func(at time.Time) bool {
		t.Helper()
		rows, err := lib.List(ctx, library.View{Country: "DE", Now: at}, library.Filter{})
		if err != nil {
			t.Fatal(err)
		}
		return rows[0].Slots[slot.Standard].LongMissing
	}
	if long(seen.Add(library.LongMissingAfter)) {
		t.Error("Long Missing at 90 days after the sighting")
	}
	if !long(seen.Add(library.LongMissingAfter + time.Hour)) {
		t.Error("not Long Missing after 90 days from the sighting")
	}
}

func TestAReleaseDateRulesOverASighting(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	upcoming := paddington()
	upcoming.ReleaseDates = metadata.ReleaseDates{{Country: "US", Type: metadata.Digital, Date: now.Add(48 * time.Hour)}}
	id, err := lib.AddMovie(ctx, library.AddMovie{
		Details: upcoming, PrimaryLanguage: "en", RootFolder: "/m", Versions: []library.VersionSpec{{Slot: slot.Standard, Profile: "hd-primary"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := lib.MarkReleaseSeen(ctx, id, now); err != nil {
		t.Fatal(err)
	}
	d, err := lib.Get(ctx, id, library.View{Country: "DE", Now: now.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	if v := d.Versions[0]; v.State != library.Unreleased {
		t.Errorf("a Movie dated in two days, seen today = %v", v.State)
	}
}

func TestAMovieWithNoReleaseDateIsSearchedOnAddThenWeeklyAfterEverythingReleased(t *testing.T) {
	ctx := context.Background()
	lib, _, _ := clocked(t)
	id := addDateless(t, lib)
	vid := mustVersion(t, lib, id)

	if got := due(t, lib, now); len(got) != 1 || got[0].VersionID != vid || !got[0].Fresh {
		t.Fatalf("on add = %+v", got)
	}
	if err := lib.MarkMissingSearched(ctx, vid, now, true); err != nil {
		t.Fatal(err)
	}
	if len(due(t, lib, now.Add(library.RetryAfter-time.Minute))) != 0 || len(due(t, lib, now.Add(library.RetryAfter))) != 1 {
		t.Error("a failed search is not retried after RetryAfter")
	}
	if err := lib.MarkMissingSearched(ctx, vid, now, false); err != nil {
		t.Fatal(err)
	}
	week := now.Add(7 * 24 * time.Hour)
	if got := due(t, lib, week.Add(-time.Minute)); len(got) != 0 {
		t.Errorf("due within the week = %+v", got)
	}
	if got := due(t, lib, week); len(got) != 1 || got[0].Fresh {
		t.Errorf("not due a week later = %+v", got)
	}

	// Something released sorts first.
	released := addPaddington(t, lib)
	if got := due(t, lib, week); len(got) != 2 || got[0].TitleID != released || got[1].TitleID != id {
		t.Errorf("order = %+v", got)
	}
}

// The sweep reads its clock before the search, which sees the Release a moment later.
func TestADatelessMovieSeenDuringItsSearchIsNotSearchedAgainAtOnce(t *testing.T) {
	ctx := context.Background()
	lib, _, _ := clocked(t)
	id := addDateless(t, lib)
	vid := mustVersion(t, lib, id)
	seen := now.Add(2 * time.Second)
	if err := lib.MarkReleaseSeen(ctx, id, seen); err != nil {
		t.Fatal(err)
	}
	if err := lib.MarkMissingSearched(ctx, vid, now, false); err != nil {
		t.Fatal(err)
	}
	if got := due(t, lib, now.Add(5*time.Minute)); len(got) != 0 {
		t.Errorf("due again at the next sweep = %+v", got)
	}
	if got := due(t, lib, seen.Add(24*time.Hour)); len(got) != 1 {
		t.Errorf("not due a day after the sighting = %+v", got)
	}
}

func TestADatelessMovieSeenBetweenSearchesRestartsTheEarlyCadence(t *testing.T) {
	ctx := context.Background()
	lib, _, _ := clocked(t)
	id := addDateless(t, lib)
	vid := mustVersion(t, lib, id)
	if err := lib.MarkMissingSearched(ctx, vid, now, false); err != nil {
		t.Fatal(err)
	}
	seen := now.Add(2 * 24 * time.Hour) // in RSS, say
	if err := lib.MarkReleaseSeen(ctx, id, seen); err != nil {
		t.Fatal(err)
	}
	if got := due(t, lib, seen.Add(24*time.Hour-time.Minute)); len(got) != 0 {
		t.Errorf("due before a day after the sighting = %+v", got)
	}
	if got := due(t, lib, seen.Add(24*time.Hour)); len(got) != 1 {
		t.Errorf("not due a day after the sighting = %+v", got)
	}
	if err := lib.MarkMissingSearched(ctx, vid, seen.Add(24*time.Hour), false); err != nil {
		t.Fatal(err)
	}
	if got := due(t, lib, seen.Add(72*time.Hour)); len(got) != 1 {
		t.Errorf("the Wanted cadence does not count from the sighting: %+v", got)
	}
}
