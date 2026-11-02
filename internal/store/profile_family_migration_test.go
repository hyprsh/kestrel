package store_test

import (
	"context"
	"testing"

	"github.com/hyprsh/kestrel/internal/store"
)

// ADR 0026: every existing Profile becomes Bluray + WEB with the language rule it has, and the rows it backs stay.
func TestReleaseFamilyMigrationMakesEveryProfileBlurayWebAndKeepsItsRule(t *testing.T) {
	dir := t.TempDir()
	ctx := context.Background()
	old, err := store.Open(ctx, store.Options{Dir: dir, Migrations: migrationsBefore(t, "00050")})
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`UPDATE profiles SET original_language = 'offer' WHERE key = 'hd-primary'`,
		`INSERT INTO titles (id, kind, title, original_title, primary_title, year, tmdb_id, root_folder, added_at, refreshed_at) VALUES (1, 'movie', 'Dune', 'Dune', 'Dune', 2021, 438631, '/m', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
		`INSERT INTO versions (id, title_id, slot, profile_key, added_at) VALUES (7, 1, 'standard', 'hd-primary', 'x')`,
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

	rows, err := s.Write().Query(`SELECT key, release_family, language_rule, original_language, trash_profile_movies FROM profiles ORDER BY sort`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	got := map[string][4]string{}
	for rows.Next() {
		var key string
		var v [4]string
		if err := rows.Scan(&key, &v[0], &v[1], &v[2], &v[3]); err != nil {
			t.Fatal(err)
		}
		got[key] = v
	}
	want := map[string][4]string{
		"hd-primary":   {"bluray-web", "primary", "offer", "hd-bluray-web"},
		"hd-original":  {"bluray-web", "original", "reject", "hd-bluray-web"},
		"any-primary":  {"bluray-web", "primary", "reject", "hd-bluray-web"},
		"any-original": {"bluray-web", "original", "reject", "hd-bluray-web"},
		"4k-primary":   {"bluray-web", "primary", "reject", "uhd-bluray-web"},
		"4k-original":  {"bluray-web", "original", "reject", "uhd-bluray-web"},
	}
	for key, w := range want {
		if got[key] != w {
			t.Errorf("%s = %v, want %v", key, got[key], w)
		}
	}
	var n int
	if err := s.Write().QueryRow(`SELECT COUNT(*) FROM versions WHERE profile_key = 'hd-primary'`).Scan(&n); err != nil || n != 1 {
		t.Errorf("versions under hd-primary = %d, %v: the rebuild must keep them", n, err)
	}

	// The recipe's own rules hold: Any is only Bluray + WEB, and a named language can offer the Original Language.
	if _, err := s.Write().Exec(`UPDATE profiles SET release_family = 'remux-web' WHERE key = 'any-primary'`); err == nil {
		t.Error("an Any Profile took a Release Family other than Bluray + WEB")
	}
	if _, err := s.Write().Exec(`UPDATE profiles SET release_family = 'nope' WHERE key = 'hd-primary'`); err == nil {
		t.Error("an unknown Release Family was stored")
	}
	if _, err := s.Write().Exec(`UPDATE profiles SET language_rule = 'de', original_language = 'offer', original_fallback = 1 WHERE key = 'hd-primary'`); err != nil {
		t.Errorf("a named-language Profile could not offer: %v", err)
	}
	if _, err := s.Write().Exec(`UPDATE profiles SET original_language = 'offer' WHERE key = 'hd-original'`); err == nil {
		t.Error("an Original-Language Profile took an Original-Language choice")
	}
}
