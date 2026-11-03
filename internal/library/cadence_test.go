package library_test

import (
	"context"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/library"
)

const day24 = 24 * hours

func TestNextMissingByRecency(t *testing.T) {
	since := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	at := func(d time.Duration) time.Time { return since.Add(d) }
	cases := []struct {
		name     string
		recency  time.Duration // before since
		searched time.Duration // after since
		next     time.Duration // after since
	}{
		// Old: Wanted more than 30 days after the content came out.
		{"old: at the add, once more a day later", 5 * 365 * day24, 0, day24},
		{"old: a little late for the day, then 30 days on", 5 * 365 * day24, 26 * hours, 30*day24 + 26*hours},
		{"old: after the extra search, every 30 days", 5 * 365 * day24, day24, 31 * day24},
		{"old: and again", 5 * 365 * day24, 31 * day24, 61 * day24},
		{"old: 31 days after the release counts as old", 31 * day24, 0, day24},
		{"old: ... and is then searched every 30 days", 31 * day24, day24, 31 * day24},
		// Recent: the early cadence from Wanted since.
		{"recent: exactly 30 days after the release is recent", 30 * day24, 0, day24},
		{"recent: day three", 30 * day24, day24, 3 * day24},
		{"recent: day seven", 30 * day24, 3 * day24, 7 * day24},
		{"recent: then weekly", 30 * day24, 7 * day24, 14 * day24},
		// Long Missing counts from the recency: here 90 days after it is day 60 after Wanted.
		{"recent, added 30 days after release: weekly until 90 days after the release", 30 * day24, 59 * day24, 66 * day24},
		{"recent, added 30 days after release: Long Missing 90 days after the release", 30 * day24, 61 * day24, 91 * day24},
		{"recent, added at the release: Long Missing 90 days on", 0, 91 * day24, 121 * day24},
		{"recent: never gives up", 0, 400 * day24, 430 * day24},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got, want := library.NextMissing(since.Add(-c.recency), since, at(c.searched)), at(c.next); !got.Equal(want) {
				t.Fatalf("NextMissing = %v after the since, want %v", got.Sub(since), want.Sub(since))
			}
		})
	}
}

// stepDue checks that a Version searched at `at` is not due a minute before `next` and is due at it.
func stepDue(t *testing.T, lib *library.Service, vid int64, at, next time.Time) {
	t.Helper()
	if err := lib.MarkMissingSearched(context.Background(), vid, at, false); err != nil {
		t.Fatal(err)
	}
	if len(due(t, lib, next.Add(-time.Minute))) != 0 {
		t.Errorf("searched at %v, still due a minute before %v", at.Sub(now), next.Sub(now))
	}
	if len(due(t, lib, next)) != 1 {
		t.Errorf("searched at %v, not due at %v", at.Sub(now), next.Sub(now))
	}
}

func TestAMovieReleasedYearsAgoAndAddedTodayIsSearchedOnAddOnceMoreADayLaterThenEveryThirtyDays(t *testing.T) {
	lib, _, _ := clocked(t)
	vid := mustVersion(t, lib, addPaddington(t, lib)) // out since 2015

	if got := due(t, lib, now); len(got) != 1 || !got[0].Fresh {
		t.Fatalf("not due on add: %+v", got)
	}
	stepDue(t, lib, vid, now, now.Add(day24))
	stepDue(t, lib, vid, now.Add(day24), now.Add(31*day24))
	stepDue(t, lib, vid, now.Add(31*day24), now.Add(61*day24))
	stepDue(t, lib, vid, now.Add(61*day24), now.Add(91*day24))
}

func TestAMovieOnUpcomingIsNotSearchedUntilItsReleaseThenKeepsTheEarlyCadence(t *testing.T) {
	lib, clock, _ := clocked(t)
	id := addMovieReleased(t, lib, 5, -3*day24) // out in three days
	vid := mustVersion(t, lib, id)
	if len(due(t, lib, now)) != 0 {
		t.Fatal("an unreleased Movie is searched")
	}
	release := now.Truncate(day24).Add(3 * day24)
	*clock = release
	if got := due(t, lib, release); len(got) != 1 || got[0].VersionID != vid {
		t.Fatalf("not due at its release: %+v", got)
	}
	// Wanted since its release, which is recent: day one, three and seven from it.
	if err := lib.MarkMissingSearched(context.Background(), vid, release, false); err != nil {
		t.Fatal(err)
	}
	if len(due(t, lib, release.Add(day24-time.Minute))) != 0 || len(due(t, lib, release.Add(day24))) != 1 {
		t.Error("not due a day after its release")
	}
}

func TestASeriesWhoseSeasonsAiredLongAgoIsSearchedOnAddOnceMoreADayLaterThenEveryThirtyDays(t *testing.T) {
	lib, _, _ := clocked(t)
	vid := mustVersion(t, lib, addShow(t, lib, library.MonitorAll))
	stepDue(t, lib, vid, now, now.Add(day24))
	stepDue(t, lib, vid, now.Add(day24), now.Add(31*day24))
	stepDue(t, lib, vid, now.Add(31*day24), now.Add(61*day24))
}

func TestFailedSearchesBackOffFifteenMinutesDoublingCappedAtTheNormalNextSearchAndACompletedSearchResetsIt(t *testing.T) {
	ctx := context.Background()
	lib, _, st := clocked(t)
	vid := mustVersion(t, lib, addMovieReleased(t, lib, 7, day24)) // recent: the normal next search is a day after the add
	failAt := func(at time.Time, wait time.Duration) {
		t.Helper()
		if err := lib.MarkMissingSearched(ctx, vid, at, true); err != nil {
			t.Fatal(err)
		}
		if len(due(t, lib, at.Add(wait-time.Second))) != 0 {
			t.Errorf("failed at %v, due before %v", at.Sub(now), wait)
		}
		if len(due(t, lib, at.Add(wait))) != 1 {
			t.Errorf("failed at %v, not due after %v", at.Sub(now), wait)
		}
	}
	at := now
	for _, wait := range []time.Duration{15 * time.Minute, 30 * time.Minute, hours, 2 * hours, 4 * hours, 8 * hours} {
		failAt(at, wait)
		at = at.Add(wait)
		if wait == 2*hours {
			// A restart keeps the count: the state is in the store.
			lib = library.New(st, func() time.Time { return at }).WithCountry(func(context.Context) string { return "US" })
		}
	}
	// 15.75 h in, 16 h would come next, but the normal next search (a day after the add) is nearer.
	failAt(at, now.Add(day24).Sub(at))
	// A completed search resets it: the next failure is 15 min again.
	if err := lib.MarkMissingSearched(ctx, vid, at, false); err != nil {
		t.Fatal(err)
	}
	failAt(at.Add(day24), 15*time.Minute)
}

func TestFailureBackoffStartsAtFifteenMinutesAndDoubles(t *testing.T) {
	want := []time.Duration{15 * time.Minute, 30 * time.Minute, hours, 2 * hours, 4 * hours}
	for i, w := range want {
		if got := library.FailureBackoff(i + 1); got != w {
			t.Errorf("backoff after %d failures = %v, want %v", i+1, got, w)
		}
	}
	if got := library.FailureBackoff(1000); got <= 0 {
		t.Errorf("a huge count overflowed: %v", got)
	}
}

func TestAnySearchFromAnyTriggerCountsAsTheVersionsSearchForTheCadence(t *testing.T) {
	lib, _, _ := clocked(t)
	vid := mustVersion(t, lib, addMovieReleased(t, lib, 9, day24))
	// A search by hand 10 hours in is not special: the day-one search moves to a day after the Wanted since.
	stepDue(t, lib, vid, now.Add(10*hours), now.Add(day24))
	// And one on day two moves the next to day three.
	stepDue(t, lib, vid, now.Add(2*day24), now.Add(3*day24))
}

func TestASearchOfOneSeasonMarksThatSeasonsRowOnly(t *testing.T) {
	ctx := context.Background()
	lib, _, st := clocked(t)
	id := addShow(t, lib, library.MonitorAll)
	vid := mustVersion(t, lib, id)
	if err := lib.MarkMissingSearchedIn(ctx, vid, now, false, []int{1}); err != nil {
		t.Fatal(err)
	}
	rows, err := st.Read().QueryContext(ctx, `SELECT season, last_missing_at FROM search_state WHERE version_id = ? ORDER BY season`, vid)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	searched := map[int]bool{}
	for rows.Next() {
		var season int
		var last *string
		if err := rows.Scan(&season, &last); err != nil {
			t.Fatal(err)
		}
		searched[season] = last != nil
	}
	if !searched[1] || searched[2] || searched[3] {
		t.Errorf("searched seasons = %v, want only season 1", searched)
	}
}

func TestRejectionsOfOneVersionDoubleACooldownBeforeTheNextRetryAndAnImportResetsIt(t *testing.T) {
	ctx := context.Background()
	lib, _, st := clocked(t)
	vid := mustVersion(t, lib, addMovieReleased(t, lib, 11, day24))
	// Searched, so that nothing is due by the cadence: only a deferred retry can make it due.
	if err := lib.MarkMissingSearched(ctx, vid, now, false); err != nil {
		t.Fatal(err)
	}

	r, err := lib.NoteRejection(ctx, vid, now)
	if err != nil || !r.Now {
		t.Fatalf("first rejection = %+v, %v, want an immediate retry", r, err)
	}
	// The second, ten minutes later, is inside the 15-minute cooldown: it waits, and the sweep is due when it ends.
	at := now.Add(10 * time.Minute)
	r, err = lib.NoteRejection(ctx, vid, at)
	if err != nil || r.Now || !r.At.Equal(now.Add(15*time.Minute)) {
		t.Fatalf("second rejection = %+v, %v, want a wait until %v", r, err, now.Add(15*time.Minute))
	}
	if len(due(t, lib, now.Add(15*time.Minute-time.Second))) != 0 || len(due(t, lib, now.Add(15*time.Minute))) != 1 {
		t.Error("the deferred retry is not due when the cooldown ends")
	}
	// After it ends the retry runs, and the next cooldown is 60 min: the third rejection doubled it twice (15, 30, 60).
	at = now.Add(16 * time.Minute)
	if r, _ = lib.NoteRejection(ctx, vid, at); !r.Now {
		t.Fatalf("a rejection after the cooldown = %+v, want a retry", r)
	}
	// A restart keeps the cooldown: after three rejections it is 60 min from the retry.
	lib = library.New(st, func() time.Time { return at }).WithCountry(func(context.Context) string { return "US" })
	if r, _ = lib.NoteRejection(ctx, vid, at.Add(59*time.Minute)); r.Now || !r.At.Equal(at.Add(time.Hour)) {
		t.Fatalf("a rejection 59 min on = %+v, want a wait until %v", r, at.Add(time.Hour))
	}

	// An Import resets: the next rejection retries at once.
	if err := lib.ClearRejections(ctx, vid); err != nil {
		t.Fatal(err)
	}
	if r, _ = lib.NoteRejection(ctx, vid, at.Add(time.Hour)); !r.Now {
		t.Fatalf("a rejection after an Import = %+v, want a retry", r)
	}
}

func TestTheRetryCooldownStartsAtFifteenMinutesDoublesAndCapsAtADay(t *testing.T) {
	want := []time.Duration{15 * time.Minute, 30 * time.Minute, hours, 2 * hours, 4 * hours, 8 * hours, 16 * hours, 24 * hours, 24 * hours}
	for i, w := range want {
		if got := library.RetryCooldown(i + 1); got != w {
			t.Errorf("cooldown after %d rejections = %v, want %v", i+1, got, w)
		}
	}
	if got := library.RetryCooldown(500); got != 24*hours {
		t.Errorf("huge count = %v", got)
	}
}
