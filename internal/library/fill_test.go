package library_test

import (
	"context"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/store"
)

func exec(t *testing.T, st *store.Store, q string, args ...any) {
	t.Helper()
	if _, err := st.Write().Exec(q, args...); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
}

func rfc(t time.Time) string { return t.UTC().Format(time.RFC3339) }

// grabFile gives a Version a file brought by a Grab, imported at `at`.
func grabFile(t *testing.T, st *store.Store, versionID, n int64, upgrade bool, at time.Time) {
	t.Helper()
	exec(t, st, `INSERT INTO grabs (id, version_id, release_guid, release_name, indexer_id, indexer_name, size, published_at, score, parsed, verdict,
		is_upgrade, client_instance_id, client_id, state, created_at, updated_at)
		VALUES (?, ?, ?, 'x', 1, 'I', 1, ?, 0, '{}', '{}', ?, 1, ?, 'imported', ?, ?)`, n, versionID, "g"+string(rune('a'+n)), rfc(at), upgrade, "c"+string(rune('a'+n)), rfc(at), rfc(at))
	exec(t, st, `INSERT INTO files (version_id, path, size, release_name, grab_id, imported_at) VALUES (?, ?, 1, 'x', ?, ?)`, versionID, "/f"+string(rune('a'+n)), n, rfc(at))
}

func TestFillTimesRunFromWantedToTheImportOfTheGrabThatFilledIt(t *testing.T) {
	ctx := context.Background()
	lib, st := newLibrary(t)
	id := addPaddington(t, lib)
	var versionID int64
	if err := st.Read().QueryRow(`SELECT id FROM versions WHERE title_id = ?`, id).Scan(&versionID); err != nil {
		t.Fatal(err)
	}
	view := newView()

	// The Movie came out in 2015 and the Version was added on 2026-10-10: Wanted since the add.
	added := time.Date(2026, 10, 10, 8, 0, 0, 0, time.UTC)
	exec(t, st, `UPDATE versions SET added_at = ?`, rfc(added))
	grabFile(t, st, versionID, 1, false, added.Add(26*time.Hour))

	fills, err := lib.FillTimes(ctx, view, added, added.AddDate(0, 0, 5))
	if err != nil {
		t.Fatal(err)
	}
	if len(fills) != 1 || fills[0].Took != 26*time.Hour || !fills[0].At.Equal(added.Add(26*time.Hour)) {
		t.Fatalf("fills = %+v, want one of 26h", fills)
	}

	// Outside the window it is not counted, and neither is an Upgrade's file.
	if got, _ := lib.FillTimes(ctx, view, added.AddDate(0, 0, 2), added.AddDate(0, 0, 5)); len(got) != 0 {
		t.Errorf("fills outside the window = %+v", got)
	}
	grabFile(t, st, versionID, 2, true, added.Add(48*time.Hour))
	if got, _ := lib.FillTimes(ctx, view, added, added.AddDate(0, 0, 5)); len(got) != 1 {
		t.Errorf("fills = %+v, want the Upgrade left out", got)
	}
}

func TestFillTimeOfAMovieReleasedAfterItWasAddedCountsFromTheRelease(t *testing.T) {
	ctx := context.Background()
	lib, st := newLibrary(t)
	id := addPaddington(t, lib)
	var versionID int64
	if err := st.Read().QueryRow(`SELECT id FROM versions WHERE title_id = ?`, id).Scan(&versionID); err != nil {
		t.Fatal(err)
	}
	released := time.Date(2026, 10, 12, 0, 0, 0, 0, time.UTC)
	exec(t, st, `DELETE FROM title_release_dates`)
	exec(t, st, `INSERT INTO title_release_dates (title_id, country, type, date) VALUES (?, 'US', 4, ?)`, id, rfc(released))
	exec(t, st, `UPDATE versions SET added_at = ?`, rfc(released.AddDate(0, 0, -30)))
	grabFile(t, st, versionID, 1, false, released.Add(3*time.Hour))

	fills, err := lib.FillTimes(ctx, newView(), released.AddDate(0, 0, -1), released.AddDate(0, 0, 1))
	if err != nil || len(fills) != 1 || fills[0].Took != 3*time.Hour {
		t.Errorf("fills = %+v, %v, want 3h from the digital release", fills, err)
	}
}

func TestFilesWithoutAGrabAreNotFills(t *testing.T) {
	ctx := context.Background()
	lib, st := newLibrary(t)
	id := addPaddington(t, lib)
	var versionID int64
	if err := st.Read().QueryRow(`SELECT id FROM versions WHERE title_id = ?`, id).Scan(&versionID); err != nil {
		t.Fatal(err)
	}
	exec(t, st, `INSERT INTO files (version_id, path, size, release_name, imported_at) VALUES (?, '/adopted', 1, 'x', ?)`, versionID, rfc(now))
	fills, err := lib.FillTimes(ctx, newView(), now.AddDate(0, 0, -1), now.AddDate(0, 0, 1))
	if err != nil || len(fills) != 0 {
		t.Errorf("fills = %+v, %v, want none for an adopted file", fills, err)
	}
}

func newView() library.View { return library.View{Country: "US", Now: now} }

func TestAnEpisodeIsWantedFromItsAirDateAndAPackFillsEachOfItsEpisodes(t *testing.T) {
	ctx := context.Background()
	lib, st := newLibrary(t)
	id := addShow(t, lib, library.MonitorAll)
	var versionID int64
	if err := st.Read().QueryRow(`SELECT id FROM versions WHERE title_id = ?`, id).Scan(&versionID); err != nil {
		t.Fatal(err)
	}
	aired1, aired2 := time.Date(2026, 10, 14, 0, 0, 0, 0, time.UTC), time.Date(2026, 10, 15, 0, 0, 0, 0, time.UTC)
	exec(t, st, `UPDATE versions SET added_at = ?`, rfc(aired1.AddDate(0, 0, -20)))
	exec(t, st, `UPDATE episodes SET air_date = ? WHERE title_id = ? AND season = 1 AND number = 1`, aired1.Format("2006-01-02"), id)
	exec(t, st, `UPDATE episodes SET air_date = ? WHERE title_id = ? AND season = 1 AND number = 2`, aired2.Format("2006-01-02"), id)

	done := aired2.Add(6 * time.Hour)
	grabFile(t, st, versionID, 1, false, done)
	exec(t, st, `INSERT INTO file_episodes (file_id, version_id, episode_id) SELECT f.id, f.version_id, e.id FROM files f, episodes e WHERE e.title_id = ? AND e.season = 1`, id)

	fills, err := lib.FillTimes(ctx, newView(), done.Add(-time.Hour), done.Add(time.Hour))
	if err != nil || len(fills) != 2 {
		t.Fatalf("fills = %+v, %v, want one per episode", fills, err)
	}
	got := map[time.Duration]bool{fills[0].Took: true, fills[1].Took: true}
	if !got[6*time.Hour] || !got[30*time.Hour] {
		t.Errorf("fills = %+v, want 6h and 30h (each episode from its own air date)", fills)
	}
}
