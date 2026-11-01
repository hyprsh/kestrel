package profiles_test

import (
	"testing"

	"github.com/hyprsh/kestrel/internal/store"
)

func mustExec(t *testing.T, st *store.Store, q string, args ...any) int64 {
	t.Helper()
	res, err := st.Write().Exec(q, args...)
	if err != nil {
		t.Fatalf("%s: %v", q, err)
	}
	id, _ := res.LastInsertId()
	return id
}

func addTitle(t *testing.T, st *store.Store, kind string) int64 {
	t.Helper()
	series := "NULL"
	if kind == "series" {
		series = "'all'"
	}
	return mustExec(t, st, `INSERT INTO titles (kind, tmdb_id, tvdb_id, title, original_title, primary_title, root_folder, added_at, refreshed_at, series_monitor)
		VALUES (?, abs(random() % 1000000000), abs(random() % 1000000000), 'T', 'T', 'T', '/r', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', `+series+`)`, kind)
}

func addVersion(t *testing.T, st *store.Store, title int64, profile string) int64 {
	t.Helper()
	slot := "standard"
	if profile == "4k-primary" {
		slot = "4k"
	}
	return mustExec(t, st, `INSERT INTO versions (title_id, slot, profile_key, added_at) VALUES (?, ?, ?, '2026-01-01T00:00:00Z')`, title, slot, profile)
}

func addFile(t *testing.T, st *store.Store, version int64, score int, parsed string, misfit bool) {
	t.Helper()
	id := mustExec(t, st, `INSERT INTO files (version_id, path, size, release_name, parsed_release, score, imported_at) VALUES (?, '/p', 1, 'r', ?, ?, '2026-01-01T00:00:00Z')`, version, parsed, score)
	if misfit {
		mustExec(t, st, `INSERT INTO file_misfits (file_id) VALUES (?)`, id)
	}
}
