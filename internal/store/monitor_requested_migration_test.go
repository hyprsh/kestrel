package store_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/store"
)

// #381: episodes added unmonitored to a monitored season of a mode-none Series are monitored; an unmonitored season, an
// old episode, a filed one, Specials and a Series with a mode stay as they are.
func TestMonitorRequestedEpisodesMigration(t *testing.T) {
	dir := t.TempDir()
	ctx := context.Background()
	old, err := store.Open(ctx, store.Options{Dir: dir, Migrations: migrationsBefore(t, "00051")})
	if err != nil {
		t.Fatal(err)
	}
	day := func(offset int) *string {
		s := time.Now().UTC().AddDate(0, 0, offset).Format("2006-01-02")
		return &s
	}
	stmts := []string{
		`INSERT INTO titles (id, kind, title, original_title, primary_title, tmdb_id, series_monitor, root_folder, added_at, refreshed_at) VALUES (1, 'series', 'Requested', 'Requested', 'Requested', 1, 'none', '/t', 'x', 'x')`,
		`INSERT INTO titles (id, kind, title, original_title, primary_title, tmdb_id, series_monitor, root_folder, added_at, refreshed_at) VALUES (2, 'series', 'Future', 'Future', 'Future', 2, 'future', '/t', 'x', 'x')`,
		`INSERT INTO seasons (title_id, number, monitored) VALUES (1, 0, 1), (1, 1, 1), (1, 2, 0), (2, 1, 1)`,
		`INSERT INTO versions (id, title_id, slot, profile_key, added_at) VALUES (9, 1, 'standard', 'hd-primary', 'x')`,
		`INSERT INTO files (id, version_id, path, size, release_name, imported_at) VALUES (5, 9, '/t/a.mkv', 1, 'a', 'x')`,
	}
	eps := []struct {
		id, title, season, number int
		air                       *string
	}{
		{1, 1, 1, 1, day(-400)}, // aired long ago: maybe the admin's choice
		{2, 1, 1, 2, day(-10)},  // aired recently
		{3, 1, 1, 3, day(7)},    // unaired
		{4, 1, 1, 4, nil},       // no air date
		{5, 1, 1, 5, day(-10)},  // has a file
		{6, 1, 2, 1, day(7)},    // unmonitored season
		{7, 1, 0, 1, day(7)},    // Specials
		{8, 2, 1, 1, day(7)},    // Series with a mode
	}
	for _, e := range eps {
		air := "NULL"
		if e.air != nil {
			air = "'" + *e.air + "'"
		}
		stmts = append(stmts, fmt.Sprintf(`INSERT INTO episodes (id, title_id, season, number, air_date, monitored) VALUES (%d, %d, %d, %d, %s, 0)`,
			e.id, e.title, e.season, e.number, air))
	}
	stmts = append(stmts, `INSERT INTO file_episodes (file_id, version_id, episode_id) VALUES (5, 9, 5)`)
	for _, q := range stmts {
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
	want := map[int]int{1: 0, 2: 1, 3: 1, 4: 1, 5: 0, 6: 0, 7: 0, 8: 0}
	for id, w := range want {
		var got int
		if err := s.Write().QueryRow(`SELECT monitored FROM episodes WHERE id = ?`, id).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != w {
			t.Errorf("episode %d monitored = %d, want %d", id, got, w)
		}
	}
}
