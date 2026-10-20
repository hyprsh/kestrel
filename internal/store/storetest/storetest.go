// Package storetest gives tests a config dir whose database is already
// migrated. Running every migration takes about 10 ms per store, and about
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
)

// Dir returns a fresh temp dir holding a copy of the migrated database, for
// store.Options.Dir.
func Dir(t testing.TB) string {
	t.Helper()
	once.Do(build)
	if buildErr != nil {
		t.Fatalf("storetest: migrate the template database: %v", buildErr)
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "kestrel.db"), template, 0o644); err != nil {
		t.Fatalf("storetest: copy the template database: %v", err)
	}
	return dir
}

// build migrates an empty database and keeps its bytes. The checkpoint folds
// the WAL into the main file, so the file alone is the whole database.
func build() {
	dir, err := os.MkdirTemp("", "kestrel-storetest-")
	if err != nil {
		buildErr = err
		return
	}
	defer os.RemoveAll(dir)
	st, err := store.Open(context.Background(), store.Options{Dir: dir})
	if err != nil {
		buildErr = err
		return
	}
	if _, err := st.Write().Exec("PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
		st.Close()
		buildErr = err
		return
	}
	if err := st.Close(); err != nil {
		buildErr = err
		return
	}
	template, buildErr = os.ReadFile(filepath.Join(dir, "kestrel.db"))
}
