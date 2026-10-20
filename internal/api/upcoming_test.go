package api_test

import (
	"context"
	"fmt"
	"testing"
	"time"
)

type upcomingJSON struct {
	From  string `json:"from"`
	To    string `json:"to"`
	Items []struct {
		Date           string  `json:"date"`
		Kind           string  `json:"kind"`
		TitleID        int64   `json:"title_id"`
		Title          string  `json:"title"`
		ReleaseType    *string `json:"release_type"`
		Season         *int    `json:"season"`
		Episode        *int    `json:"episode"`
		SearchableFrom *string `json:"searchable_from"`
		Released       bool    `json:"released"`
	} `json:"items"`
}

func (w wantedRig) exec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := w.in.st.Write().ExecContext(context.Background(), query, args...); err != nil {
		t.Fatal(err)
	}
}

func (w wantedRig) upcoming(t *testing.T, query string) upcomingJSON {
	t.Helper()
	r := w.valid("GET", "/upcoming"+query, "")
	if r.Status != 200 {
		t.Fatalf("GET /upcoming%s = %d %s", query, r.Status, r.Body)
	}
	return decode[upcomingJSON](t, r)
}

// setDates replaces a Movie's release dates with US ones: type -> date.
func (w wantedRig) setDates(t *testing.T, titleID int64, dates map[int]string) {
	t.Helper()
	w.exec(t, `DELETE FROM title_release_dates WHERE title_id = ?`, titleID)
	for typ, d := range dates {
		w.exec(t, `INSERT INTO title_release_dates (title_id, country, type, date) VALUES (?, 'US', ?, ?)`, titleID, typ, d)
	}
}

// The fake clock stands at 2026-10-17, so the default window is 10-17 to 11-16.
func TestUpcomingListsMonitoredEpisodesAndTypedMovieDatesInTheWindow(t *testing.T) {
	t.Parallel()
	w := newWantedRig(t)
	movie := decode[titleJSON](t, w.valid("POST", "/titles", fmt.Sprintf(addHD, 116149)))
	w.setDates(t, movie.ID, map[int]string{
		3: "2026-10-20T00:00:00Z", // theatrical, in the window
		4: "2026-11-05T00:00:00Z", // digital, in the window
		5: "2026-12-25T00:00:00Z", // physical, past it
	})
	series := decode[seriesTitleJSON](t, w.valid("POST", "/titles", addBreakingBad+`,"series_monitor":"all"}`))
	w.exec(t, `UPDATE episodes SET air_date = '2026-01-01' WHERE title_id = ?`, series.ID)
	w.exec(t, `UPDATE episodes SET air_date = '2026-10-18' WHERE title_id = ? AND season = 1 AND number = 1`, series.ID)
	w.exec(t, `UPDATE episodes SET air_date = '2026-10-19', monitored = 0 WHERE title_id = ? AND season = 1 AND number = 2`, series.ID)
	w.exec(t, `UPDATE episodes SET air_date = '2026-11-17' WHERE title_id = ? AND season = 1 AND number = 3`, series.ID)

	got := w.upcoming(t, "")
	if got.From != "2026-10-17" || got.To != "2026-11-16" {
		t.Errorf("window = %s..%s, want 2026-10-17..2026-11-16", got.From, got.To)
	}
	var lines []string
	for _, i := range got.Items {
		typ := ""
		if i.ReleaseType != nil {
			typ = *i.ReleaseType
		}
		lines = append(lines, i.Date+" "+i.Kind+" "+typ)
	}
	want := []string{"2026-10-18 series ", "2026-10-20 movie theatrical", "2026-11-05 movie digital"}
	if fmt.Sprint(lines) != fmt.Sprint(want) {
		t.Fatalf("agenda = %q, want %q", lines, want)
	}
	if e := got.Items[0]; e.Season == nil || *e.Season != 1 || *e.Episode != 1 {
		t.Errorf("episode line = %+v, want S01E01", e)
	}

	// A narrower window drops what lies outside it.
	if n := len(w.upcoming(t, "?from=2026-10-19&to=2026-10-31").Items); n != 1 {
		t.Errorf("window 10-19..10-31 has %d lines, want the theatrical date only", n)
	}
	// Moving the clock moves the default window.
	w.in.clock.Advance(20 * 24 * time.Hour)
	if got := w.upcoming(t, ""); got.From != "2026-11-06" || len(got.Items) != 1 || got.Items[0].Date != "2026-11-17" {
		t.Errorf("after 20 days: %+v, want only the 11-17 episode", got)
	}
}

func TestUpcomingSkipsMoviesThatAreFilledOrUnmonitoredAndSaysWhenAnUnreleasedOneIsSearchable(t *testing.T) {
	t.Parallel()
	w := newWantedRig(t)
	filled := decode[titleJSON](t, w.valid("POST", "/titles", fmt.Sprintf(addHD, 116149)))
	other := decode[titleJSON](t, w.valid("POST", "/titles", fmt.Sprintf(addHD, 77)))
	soon := map[int]string{3: "2026-10-20T00:00:00Z"}
	w.setDates(t, filled.ID, soon)
	w.setDates(t, other.ID, soon)
	w.exec(t, `INSERT INTO files (version_id, path, size, release_name, imported_at) SELECT id, 'x.mkv', 1, 'x', '2026-10-01T00:00:00Z' FROM versions WHERE title_id = ?`, filled.ID)
	w.exec(t, `UPDATE titles SET monitored = 0 WHERE id = ?`, other.ID)
	if n := len(w.upcoming(t, "").Items); n != 0 {
		t.Fatalf("filled and unmonitored Movies listed %d lines, want none", n)
	}

	// In cinemas on 10-20, no home release: searchable 90 days later (2027-01-18).
	w.exec(t, `UPDATE titles SET monitored = 1 WHERE id = ?`, other.ID)
	got := w.upcoming(t, "").Items
	if len(got) != 1 || got[0].TitleID != other.ID {
		t.Fatalf("agenda = %+v, want the monitored unfilled Movie", got)
	}
	if got[0].Released || got[0].SearchableFrom == nil || *got[0].SearchableFrom != "2027-01-18" {
		t.Errorf("searchable = %v released = %v, want 2027-01-18 and not released", got[0].SearchableFrom, got[0].Released)
	}

	// A digital date that has come makes it searchable now.
	w.setDates(t, other.ID, map[int]string{3: "2026-10-20T00:00:00Z", 4: "2026-10-17T00:00:00Z"})
	got = w.upcoming(t, "").Items
	if len(got) != 2 || !got[0].Released {
		t.Errorf("agenda = %+v, want a digital line (today) and a theatrical one, released", got)
	}
}

func TestUpcomingRejectsAnInvertedWindow(t *testing.T) {
	t.Parallel()
	w := newWantedRig(t)
	if r := w.do("GET", "/upcoming?from=2026-10-20&to=2026-10-19", ""); r.Status != 422 {
		t.Errorf("status = %d, want 422", r.Status)
	}
}

func TestRecentlyAddedListsTheLatestImportsNewestFirst(t *testing.T) {
	t.Parallel()
	w := newWantedRig(t)
	a := decode[titleJSON](t, w.valid("POST", "/titles", fmt.Sprintf(addHD, 116149)))
	b := decode[titleJSON](t, w.valid("POST", "/titles", fmt.Sprintf(addHD, 77)))
	for i, f := range []struct {
		title int64
		at    string
		score int
	}{{a.ID, "2026-10-10T00:00:00Z", 100}, {b.ID, "2026-10-12T00:00:00Z", 250}} {
		w.exec(t, `INSERT INTO files (version_id, path, size, release_name, score, grab_id, imported_at) SELECT id, ?, 1, ?, ?, ?, ? FROM versions WHERE title_id = ?`,
			fmt.Sprintf("f%d.mkv", i), fmt.Sprintf("Release.%d", i), f.score, i+1, f.at, f.title)
	}
	// An adopted file (no Grab) is not an Import.
	w.exec(t, `INSERT INTO files (version_id, path, size, release_name, score, imported_at) SELECT id, 'adopted.mkv', 1, 'Adopted', 1, '2026-10-16T00:00:00Z' FROM versions WHERE title_id = ?`, a.ID)
	got := decode[struct {
		Items []struct {
			TitleID int64 `json:"title_id"`
			Score   *int  `json:"score"`
			Files   int   `json:"files"`
		} `json:"items"`
	}](t, w.valid("GET", "/recent", ""))
	if len(got.Items) != 2 || got.Items[0].TitleID != b.ID || got.Items[1].TitleID != a.ID || *got.Items[0].Score != 250 {
		t.Errorf("recent = %+v, want the newer Import first", got.Items)
	}
}
