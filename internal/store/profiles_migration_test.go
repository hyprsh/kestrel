package store_test

import (
	"context"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/store"
)

func TestDetachingProfilesKeepsTheDefaultsAnExistingLibraryResolved(t *testing.T) {
	dir := t.TempDir()
	ctx := context.Background()
	old, err := store.Open(ctx, store.Options{Dir: dir, Migrations: migrationsBefore(t, "00047")})
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		// The household made HD Original the Standard default for Movies; 4K never had a flagged default.
		`UPDATE profiles SET default_movies = 0 WHERE key = 'hd-primary'`,
		`UPDATE profiles SET default_movies = 1 WHERE key = 'hd-original'`,
		`UPDATE slots SET default_movies = 'hd-original' WHERE id = 'standard'`,
		`INSERT INTO titles (id, kind, title, original_title, primary_title, year, tmdb_id, root_folder, added_at, refreshed_at) VALUES (1, 'movie', 'Dune', 'Dune', 'Dune', 2021, 438631, '/m', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
		`INSERT INTO versions (id, title_id, slot, profile_key, added_at) VALUES (7, 1, 'standard', 'hd-primary', 'x'), (8, 1, '4k', '4k-primary', 'x')`,
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

	got := map[string]string{}
	rows, err := s.Write().Query(`SELECT id, COALESCE(default_movies, '') || '/' || COALESCE(default_series, '') FROM slots`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id, d string
		if err := rows.Scan(&id, &d); err != nil {
			t.Fatal(err)
		}
		got[id] = d
	}
	rows.Close()
	if got["standard"] != "hd-original/hd-primary" || got["4k"] != "4k-primary/4k-primary" {
		t.Errorf("slot defaults = %v, want what Profile resolution gave before: hd-original/hd-primary and 4k-primary/4k-primary", got)
	}

	for _, col := range []string{"slot", "default_movies", "default_series"} {
		if _, err := s.Write().Exec(`SELECT ` + col + ` FROM profiles`); err == nil {
			t.Errorf("profiles still has %s", col)
		}
	}
	var n int
	if err := s.Write().QueryRow(`SELECT COUNT(*) FROM versions`).Scan(&n); err != nil || n != 2 {
		t.Errorf("versions = %d, %v: the rebuild must keep them", n, err)
	}

	// A Profile can fill any Slot, but not twice in one Title.
	if _, err := s.Write().Exec(`UPDATE versions SET profile_key = '4k-primary' WHERE id = 7`); err == nil || !strings.Contains(err.Error(), "UNIQUE") {
		t.Errorf("two Versions of a Title under one Profile: %v", err)
	}
}
