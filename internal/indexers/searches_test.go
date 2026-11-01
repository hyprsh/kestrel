package indexers_test

import (
	"context"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/indexers"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	"github.com/hyprsh/kestrel/internal/plugin/indexer/v1/fake"
)

type searchRow struct {
	ID         int64
	IndexerID  int64
	Name       string
	OK, Fit    bool
	Releases   int
	DurationMS int64
}

func (r rig) searches(t *testing.T) []searchRow {
	t.Helper()
	rows, err := r.st.Read().QueryContext(context.Background(), `SELECT id, indexer_id, indexer_name, ok, fit, releases, duration_ms FROM indexer_searches ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []searchRow
	for rows.Next() {
		var s searchRow
		if err := rows.Scan(&s.ID, &s.IndexerID, &s.Name, &s.OK, &s.Fit, &s.Releases, &s.DurationMS); err != nil {
			t.Fatal(err)
		}
		out = append(out, s)
	}
	return out
}

func TestEachIndexersLaneOfASearchIsRecordedWithItsOutcomeAndReleases(t *testing.T) {
	good, bad := fake.New("k"), fake.New("wrong key")
	r := newRig(t, namedFake{good, "idx_good"}, namedFake{bad, "idx_bad"})
	goodID := r.add(t, "idx_good", "Good", 1)
	badID := r.add(t, "idx_bad", "Bad", 2)
	publish(t, good, "Paddington.2014.1080p.BluRay.x264-GRP", "tt1109624", time.Now())

	res := r.svc.Search(context.Background(), indexers.Query{Media: indexer.MediaMovie, IMDBID: "tt1109624"})

	rows := r.searches(t)
	if len(rows) != 2 {
		t.Fatalf("recorded %+v, want a row per lane", rows)
	}
	byIndexer := map[int64]searchRow{}
	for _, row := range rows {
		byIndexer[row.IndexerID] = row
	}
	if g := byIndexer[goodID]; g.Name != "Good" || !g.OK || g.Releases != 1 || g.Fit || g.DurationMS < 0 {
		t.Errorf("good lane = %+v", g)
	}
	if b := byIndexer[badID]; b.Name != "Bad" || b.OK || b.Releases != 0 {
		t.Errorf("failing lane = %+v, want it recorded as not answered", b)
	}
	if res.Searches[goodID] != byIndexer[goodID].ID || res.Searches[badID] != byIndexer[badID].ID {
		t.Errorf("Result.Searches = %v, want the recorded row of each lane", res.Searches)
	}
}

func TestMarkFitFlagsOnlyTheNamedIndexersLanes(t *testing.T) {
	a, b := fake.New("k"), fake.New("k")
	r := newRig(t, namedFake{a, "idx_a"}, namedFake{b, "idx_b"})
	idA := r.add(t, "idx_a", "Alpha", 1)
	idB := r.add(t, "idx_b", "Beta", 2)
	publish(t, a, "Paddington.2014.1080p.BluRay.x264-GRP", "tt1109624", time.Now())
	publish(t, b, "Paddington.2014.480p.DVD.x264-GRP", "tt1109624", time.Now())
	res := r.svc.Search(context.Background(), indexers.Query{Media: indexer.MediaMovie, IMDBID: "tt1109624"})

	r.svc.MarkFit(context.Background(), res.Searches, map[int64]bool{idA: true})

	for _, row := range r.searches(t) {
		if want := row.IndexerID == idA; row.Fit != want {
			t.Errorf("%s fit = %v, want %v", row.Name, row.Fit, want)
		}
	}
	_ = idB
}

func TestRSSReadsAndPausedLanesAreNotSearches(t *testing.T) {
	f, paused := fake.New("k"), fake.New("k")
	r := newRig(t, namedFake{f, "idx_a"}, namedFake{paused, "idx_b"})
	r.add(t, "idx_a", "Alpha", 1)
	r.add(t, "idx_b", "Beta", 2)
	paused.Exhaust("search", time.Minute)

	r.svc.RSS(context.Background())
	if rows := r.searches(t); len(rows) != 0 {
		t.Fatalf("an RSS read recorded %+v", rows)
	}
	r.svc.Search(context.Background(), indexers.Query{Media: indexer.MediaMovie, IMDBID: "tt1"})
	rows := r.searches(t)
	if len(rows) != 1 || rows[0].Name != "Alpha" {
		t.Errorf("recorded %+v, want only Alpha: a rate-limited indexer was not really asked", rows)
	}
}

func TestOldSearchesArePrunedWhenANewOneIsRecorded(t *testing.T) {
	f := fake.New("k")
	r := newRig(t, f)
	id := r.add(t, fake.ID, "Alpha", 1)
	old := time.Now().AddDate(0, 0, -200).UTC().Format(time.RFC3339)
	if _, err := r.st.Write().Exec(`INSERT INTO indexer_searches (indexer_id, indexer_name, at, ok, releases, duration_ms) VALUES (?, 'Alpha', ?, 1, 0, 5)`, id, old); err != nil {
		t.Fatal(err)
	}
	r.svc.Search(context.Background(), indexers.Query{Media: indexer.MediaMovie, IMDBID: "tt1"})
	if rows := r.searches(t); len(rows) != 1 || rows[0].ID == 1 {
		t.Errorf("rows = %+v, want only the new search", rows)
	}
}
