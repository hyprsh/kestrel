// Package storetest gives tests a config dir whose database is already
// migrated. Dir holds the six Profiles and the 4K Slot that installs before
// ADR 0026 have, which the tests were written against; FreshDir holds what a
// fresh install gets (no Profiles, only the Standard Slot). Running every migration takes about 10 ms per store, and about
// 140 ms under the race detector; copying a database migrated once per test
// binary takes about a tenth of that. store.Open then finds nothing to migrate.
package storetest

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/hyprsh/kestrel/internal/store"
)

var (
	once     sync.Once
	template []byte
	buildErr error

	freshOnce     sync.Once
	freshTemplate []byte
	freshErr      error
)

// legacySeed is the six Profiles and the 4K Slot every install had before a fresh install started empty, with the
// defaults the Slots carried. Dir's template database holds it.
const legacySeed = `
INSERT INTO profiles (key, name, sort, any, language_rule, min_height, max_height, trash_profile_movies, trash_profile_series) VALUES
    ('hd-primary',   'HD',           1, 0, 'primary',  720,  1080, 'hd-bluray-web',  'web-1080p'),
    ('hd-original',  'HD Original',  2, 0, 'original', 720,  1080, 'hd-bluray-web',  'web-1080p'),
    ('any-primary',  'Any',          3, 1, 'primary',  0,    1080, 'hd-bluray-web',  'web-1080p'),
    ('any-original', 'Any Original', 4, 1, 'original', 0,    1080, 'hd-bluray-web',  'web-1080p'),
    ('4k-primary',   '4K',           5, 0, 'primary',  2160, 2160, 'uhd-bluray-web', 'web-2160p'),
    ('4k-original',  '4K Original',  6, 0, 'original', 2160, 2160, 'uhd-bluray-web', 'web-2160p');
UPDATE slots SET default_movies = 'hd-primary', default_series = 'hd-primary' WHERE id = 'standard';
INSERT INTO slots (id, label, default_movies, default_series, on_for_new, position) VALUES ('4k', '4K', '4k-primary', '4k-primary', 0, 1);
`

// FreshDir returns a temp dir holding a copy of a database as a fresh install leaves it: no Profiles, one Slot.
func FreshDir(t testing.TB) string {
	t.Helper()
	freshOnce.Do(func() { freshTemplate, freshErr = build(false) })
	return copyTemplate(t, freshTemplate, freshErr)
}

// Dir returns a fresh temp dir holding a copy of the migrated database with the legacy Profiles and 4K Slot seeded, for store.Options.Dir.
func Dir(t testing.TB) string {
	t.Helper()
	once.Do(func() { template, buildErr = build(true) })
	return copyTemplate(t, template, buildErr)
}

func copyTemplate(t testing.TB, data []byte, err error) string {
	t.Helper()
	if err != nil {
		t.Fatalf("storetest: migrate the template database: %v", err)
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "kestrel.db"), data, 0o644); err != nil {
		t.Fatalf("storetest: copy the template database: %v", err)
	}
	return dir
}

// build migrates an empty database and keeps its bytes, with the legacy seed when legacy. The checkpoint folds
// the WAL into the main file, so the file alone is the whole database.
func build(legacy bool) ([]byte, error) {
	dir, err := os.MkdirTemp("", "kestrel-storetest-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	st, err := store.Open(context.Background(), store.Options{Dir: dir})
	if err != nil {
		return nil, err
	}
	if legacy {
		if _, err := st.Write().Exec(legacySeed); err != nil {
			st.Close()
			return nil, err
		}
	}
	if _, err := st.Write().Exec("PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
		st.Close()
		return nil, err
	}
	if err := st.Close(); err != nil {
		return nil, err
	}
	return os.ReadFile(filepath.Join(dir, "kestrel.db"))
}
