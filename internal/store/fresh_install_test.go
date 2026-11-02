package store_test

import (
	"context"
	"testing"

	"github.com/hyprsh/kestrel/internal/store"
)

func slotRows(t *testing.T, s *store.Store) (rows []string) {
	t.Helper()
	r, err := s.Read().Query(`SELECT id || '|' || label || '|' || COALESCE(default_movies, '-') || '|' || COALESCE(default_series, '-') || '|' || on_for_new FROM slots ORDER BY position`)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	for r.Next() {
		var s string
		if err := r.Scan(&s); err != nil {
			t.Fatal(err)
		}
		rows = append(rows, s)
	}
	return rows
}

func profileKeys(t *testing.T, s *store.Store) (keys []string) {
	t.Helper()
	r, err := s.Read().Query(`SELECT key FROM profiles ORDER BY sort`)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	for r.Next() {
		var k string
		if err := r.Scan(&k); err != nil {
			t.Fatal(err)
		}
		keys = append(keys, k)
	}
	return keys
}

func TestFreshDatabaseHasNoProfilesAndOnlyTheStandardSlot(t *testing.T) {
	s, err := store.Open(context.Background(), store.Options{Dir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if keys := profileKeys(t, s); len(keys) != 0 {
		t.Fatalf("profiles = %v, want none", keys)
	}
	if got := slotRows(t, s); len(got) != 1 || got[0] != "standard|Standard|-|-|1" {
		t.Fatalf("slots = %v", got)
	}
}

func TestUpgradedDatabaseKeepsItsProfilesAndSlots(t *testing.T) {
	dir := t.TempDir()
	ctx := context.Background()
	old, err := store.Open(ctx, store.Options{Dir: dir, Migrations: migrationsBefore(t, "00050")})
	if err != nil {
		t.Fatal(err)
	}
	before := slotRows(t, old)
	old.Close()

	s, err := store.Open(ctx, store.Options{Dir: dir})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if keys := profileKeys(t, s); len(keys) != 6 {
		t.Fatalf("profiles = %v, want the six", keys)
	}
	got := slotRows(t, s)
	if len(got) != 2 || len(before) != 2 || got[0] != before[0] || got[1] != before[1] {
		t.Fatalf("slots = %v, before %v", got, before)
	}
}
