package api_test

import (
	"encoding/json"
	"fmt"
	"testing"
)

// addSeries writes a Series with one episode airing on day straight into the database, as another process or a job would.
func addSeries(t *testing.T, in *instance, n int, day string) {
	t.Helper()
	db := in.st.Write()
	res, err := db.Exec(`insert into titles (kind, tvdb_id, title, original_title, primary_title, year, monitored, series_monitor, root_folder, added_at, refreshed_at)
		values ('series', ?, ?, ?, ?, 2020, 1, 'all', '/media', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`, 9000+n, fmt.Sprint("Cached ", n), fmt.Sprint("Cached ", n), fmt.Sprint("Cached ", n))
	if err != nil {
		t.Fatal(err)
	}
	id, _ := res.LastInsertId()
	if _, err := db.Exec(`insert into versions (title_id, slot, profile_key, added_at) values (?, 'standard', 'hd-primary', '2026-01-01T00:00:00Z')`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`insert into seasons (title_id, number, monitored) values (?, 1, 1)`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`insert into episodes (title_id, season, number, name, air_date, monitored, primary_name) values (?, 1, 1, 'Pilot', ?, 1, 'Pilot')`, id, day); err != nil {
		t.Fatal(err)
	}
}

func TestStatsAndUpcomingAreCachedAndAWriteInvalidatesThem(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	b := in.setUp()
	today := in.clock.Now().UTC().Format("2006-01-02")

	titles := func() int {
		var s struct {
			Library struct{ Titles int }
		}
		if err := json.Unmarshal([]byte(b.get("/stats").Body), &s); err != nil {
			t.Fatal(err)
		}
		return s.Library.Titles
	}
	upcoming := func() int {
		var u struct{ Items []json.RawMessage }
		if err := json.Unmarshal([]byte(b.get("/upcoming?from="+today+"&to="+today).Body), &u); err != nil {
			t.Fatal(err)
		}
		return len(u.Items)
	}
	if titles() != 0 || upcoming() != 0 {
		t.Fatalf("an empty Library: %d Titles, %d upcoming", titles(), upcoming())
	}

	addSeries(t, in, 1, today)

	if got := titles(); got != 1 {
		t.Errorf("/stats after a write counted %d Titles, want 1: the cache was not invalidated", got)
	}
	if got := upcoming(); got != 1 {
		t.Errorf("/upcoming after a write listed %d, want 1: the cache was not invalidated", got)
	}
	// And between writes the answer is the kept one: the same bytes, without building again.
	first := b.get("/upcoming?from=" + today + "&to=" + today).Body
	if second := b.get("/upcoming?from=" + today + "&to=" + today).Body; second != first {
		t.Errorf("two reads with no write between them differ")
	}
}
