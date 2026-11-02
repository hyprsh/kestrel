package store_test

import (
	"context"
	"io/fs"
	"os"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/hyprsh/kestrel/internal/store"
)

// migrationsBefore is the real migrations whose file name sorts before n.
func migrationsBefore(t *testing.T, n string) fstest.MapFS {
	t.Helper()
	out := fstest.MapFS{}
	entries, err := os.ReadDir("migrations")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if e.Name() >= n {
			continue
		}
		raw, err := fs.ReadFile(os.DirFS("migrations"), e.Name())
		if err != nil {
			t.Fatal(err)
		}
		out[e.Name()] = &fstest.MapFile{Data: raw}
	}
	return out
}

func TestSlotsMigrationKeepsEveryVersionAndFile(t *testing.T) {
	dir := t.TempDir()
	ctx := context.Background()
	old, err := store.Open(ctx, store.Options{Dir: dir, Migrations: migrationsBefore(t, "00046")})
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`INSERT INTO titles (id, kind, title, original_title, primary_title, year, tmdb_id, root_folder, added_at, refreshed_at) VALUES (1, 'movie', 'Dune', 'Dune', 'Dune', 2021, 438631, '/m', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
		`INSERT INTO versions (id, title_id, slot, profile_key, added_at) VALUES (7, 1, 'standard', 'hd-primary', '2026-01-01T00:00:00Z'), (8, 1, '4k', '4k-primary', '2026-01-01T00:00:00Z')`,
		`INSERT INTO files (id, version_id, path, size, release_name, imported_at) VALUES (3, 8, '/m/Dune.mkv', 10, 'Dune', '2026-01-01T00:00:00Z')`,
		`INSERT INTO requests (id, source, source_request_id, requester_id, requester_name, title_id, outcome, created_at) VALUES (1, 'silo', 'r1', 'u1', 'Ann', 1, 'accepted', '2026-01-01T00:00:00Z')`,
		`INSERT INTO request_slots (request_id, slot, profile_key, version_id) VALUES (1, '4k', '4k-primary', 8)`,
	} {
		if _, err := old.Write().Exec(q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	old.Close()

	s, err := store.Open(ctx, store.Options{Dir: dir})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	count := func(q string) (n int) {
		t.Helper()
		if err := s.Write().QueryRow(q).Scan(&n); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
		return n
	}
	if n := count(`SELECT COUNT(*) FROM versions`); n != 2 {
		t.Errorf("versions = %d, want 2", n)
	}
	if n := count(`SELECT COUNT(*) FROM files WHERE version_id = 8`); n != 1 {
		t.Errorf("files under the 4K version = %d, want 1 (a rebuild must not cascade)", n)
	}
	if n := count(`SELECT COUNT(*) FROM request_slots WHERE slot = '4k' AND version_id = 8`); n != 1 {
		t.Errorf("request slots = %d, want 1", n)
	}
	if n := count(`PRAGMA foreign_keys`); n != 1 {
		t.Errorf("foreign_keys = %d after migrating, want 1", n)
	}

	var ids, labels, onNew string
	var stdMovies, stdSeries string
	if err := s.Write().QueryRow(`SELECT group_concat(id), group_concat(label), group_concat(on_for_new) FROM (SELECT * FROM slots ORDER BY position)`).Scan(&ids, &labels, &onNew); err != nil {
		t.Fatal(err)
	}
	if ids != "standard,4k" || labels != "Standard,4K" || onNew != "1,0" {
		t.Errorf("slots = %s / %s / %s", ids, labels, onNew)
	}
	if err := s.Write().QueryRow(`SELECT default_movies, default_series FROM slots WHERE id = 'standard'`).Scan(&stdMovies, &stdSeries); err != nil {
		t.Fatal(err)
	}
	if stdMovies != "hd-primary" || stdSeries != "hd-primary" {
		t.Errorf("Standard defaults = %q / %q, want today's hd-primary", stdMovies, stdSeries)
	}

	// A new Slot can hold a Version; a Version of an unknown Slot cannot exist.
	if _, err := s.Write().Exec(`INSERT INTO slots (id, label, on_for_new, position) VALUES ('remux', 'Remux', 0, 2)`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Write().Exec(`INSERT INTO versions (title_id, slot, profile_key, added_at) VALUES (1, 'remux', 'hd-primary', 'x')`); err != nil {
		t.Errorf("a Version in a new Slot: %v", err)
	}
	if _, err := s.Write().Exec(`INSERT INTO versions (title_id, slot, profile_key, added_at) VALUES (1, 'nope', 'hd-primary', 'x')`); err == nil || !strings.Contains(err.Error(), "FOREIGN KEY") {
		t.Errorf("a Version in an unknown Slot: %v", err)
	}
}
