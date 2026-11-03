package library_test

import (
	"context"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/slot"
)

// A Wanted Version scheduled weeks ahead is searched sooner by the sweep when an episode aired after its last search; the
// next search the Title page shows is the sweep's (dueAt), not the stored one.
func TestTheNextSearchIsWhenTheSweepSearchesIncludingThePullForwardAfterANewlyAiredEpisode(t *testing.T) {
	ctx := context.Background()
	lib, clock, st := clocked(t)
	d, _ := show()
	v := metadata.TVDBSeries{ID: 81189, Name: "Breaking Bad", Episodes: []metadata.Episode{
		{ID: 2, Season: 1, Number: 1, Name: "Pilot", Aired: aired(2008, 1, 20)},
		{ID: 3, Season: 1, Number: 2, Name: "Fresh", Aired: aired(2026, 10, 19)}, // airs after the last search
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
	if err := lib.MarkMissingSearched(ctx, vid, at(18, 12), false); err != nil {
		t.Fatal(err)
	}
	stored := at(18, 12).Add(20 * 24 * time.Hour) // scheduled in 20 days
	if _, err := st.Write().ExecContext(ctx, `UPDATE search_state SET next_missing_at = ? WHERE version_id = ?`, stored.UTC().Format(time.RFC3339Nano), vid); err != nil {
		t.Fatal(err)
	}

	*clock = at(19, 12) // the episode has aired, after the last search
	got, err := lib.NextSearches(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	want := at(20, 0) // a day after the episode aired
	if n := got[vid]; n.Missing == nil || !n.Missing.Equal(want) {
		t.Fatalf("next search = %v, want %v (not the stored %v)", n.Missing, want, stored)
	}
	if many, _ := lib.NextSearchesOf(ctx, []int64{vid}); many[vid].Missing == nil || !many[vid].Missing.Equal(want) {
		t.Errorf("NextSearchesOf = %v, want %v", many[vid].Missing, want)
	}
	if len(due(t, lib, want.Add(-time.Second))) != 0 {
		t.Error("the sweep picked the Version before the next search")
	}
	if len(due(t, lib, want)) != 1 {
		t.Error("the sweep did not pick the Version at the next search")
	}
}

func TestTheNextSearchOfAVersionIsWhenItsSearchStateIsDue(t *testing.T) {
	ctx := context.Background()
	lib, _, _ := clocked(t)
	id := addPaddington(t, lib)
	vid := mustVersion(t, lib, id)

	got, err := lib.NextSearches(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if n, ok := got[vid]; !ok || n.Missing == nil || !n.Missing.Equal(now) {
		t.Fatalf("on add the next search is %+v, want it due now", got[vid])
	}

	if err := lib.MarkMissingSearched(ctx, vid, now, false); err != nil {
		t.Fatal(err)
	}
	got, _ = lib.NextSearches(ctx, id)
	if n := got[vid]; n.Missing == nil || !n.Missing.Equal(now.Add(24*time.Hour)) {
		t.Errorf("after the first search the next is %v, want a day after it became Wanted", n.Missing)
	}
}

func TestANextSearchOfAnotherTitleIsNotMixedIn(t *testing.T) {
	ctx := context.Background()
	lib, _, _ := clocked(t)
	id := addPaddington(t, lib)

	got, err := lib.NextSearches(ctx, id+100)
	if err != nil || len(got) != 0 {
		t.Errorf("NextSearches of an unknown Title = %v, %v; want none", got, err)
	}
}

func TestNextSearchesOfVersionsAreTheSameAsOfTheirTitleAndLeaveOthersOut(t *testing.T) {
	ctx := context.Background()
	lib, _, _ := clocked(t)
	id := addPaddington(t, lib)
	vid := mustVersion(t, lib, id)

	one, err := lib.NextSearches(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	many, err := lib.NextSearchesOf(ctx, []int64{vid})
	if err != nil {
		t.Fatal(err)
	}
	if len(many) != 1 || many[vid].Missing == nil || !many[vid].Missing.Equal(*one[vid].Missing) {
		t.Errorf("NextSearchesOf = %+v, want the Title's %+v", many, one)
	}
	if none, _ := lib.NextSearchesOf(ctx, []int64{vid + 100}); len(none) != 0 {
		t.Errorf("an unknown Version has next searches %v", none)
	}
}
