package store_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/hyprsh/kestrel/internal/store"
)

// migrationsUpTo builds an in-memory goose migration set with n trivial
// migrations, each adding one table.
func migrationsUpTo(n int) fstest.MapFS {
	fsys := fstest.MapFS{}
	for i := 1; i <= n; i++ {
		fsys[fmt.Sprintf("%05d_t%d.sql", i, i)] = &fstest.MapFile{Data: []byte(fmt.Sprintf(
			"-- +goose Up\nCREATE TABLE t%d (id INTEGER PRIMARY KEY);\n-- +goose Down\nDROP TABLE t%d;\n", i, i))}
	}
	return fsys
}

func open(dir string, n int) (*store.Store, error) {
	return store.Open(context.Background(), store.Options{Dir: dir, Migrations: migrationsUpTo(n)})
}

func mustOpen(t *testing.T, dir string, n int) *store.Store {
	t.Helper()
	s, err := open(dir, n)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func backups(t *testing.T, dir string) []string {
	t.Helper()
	m, err := filepath.Glob(filepath.Join(dir, "backups", "kestrel-*.db"))
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func TestOpenAppliesMigrationsInWALMode(t *testing.T) {
	dir := t.TempDir()
	s := mustOpen(t, dir, 2)

	var mode string
	if err := s.Write().QueryRow("PRAGMA journal_mode").Scan(&mode); err != nil {
		t.Fatal(err)
	}
	if mode != "wal" {
		t.Fatalf("journal_mode = %q, want wal", mode)
	}
	if _, err := s.Write().Exec("INSERT INTO t2 DEFAULT VALUES"); err != nil {
		t.Fatalf("migrated table missing: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "kestrel.db")); err != nil {
		t.Fatalf("database file: %v", err)
	}
}

func TestReadPoolSeesWritesAndRejectsWriting(t *testing.T) {
	s := mustOpen(t, t.TempDir(), 1)
	if _, err := s.Write().Exec("INSERT INTO t1 DEFAULT VALUES"); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := s.Read().QueryRow("SELECT count(*) FROM t1").Scan(&n); err != nil || n != 1 {
		t.Fatalf("read count = %d, err = %v", n, err)
	}
	if _, err := s.Read().Exec("INSERT INTO t1 DEFAULT VALUES"); err == nil {
		t.Fatal("read pool accepted a write")
	}
}

func TestFreshDatabaseTakesNoBackup(t *testing.T) {
	dir := t.TempDir()
	mustOpen(t, dir, 1).Close()
	if got := backups(t, dir); len(got) != 0 {
		t.Fatalf("backups on a fresh database: %v", got)
	}
}

func TestMigrationBacksUpFirstAndKeepsNewestFive(t *testing.T) {
	dir := t.TempDir()
	mustOpen(t, dir, 1).Close()
	for n := 2; n <= 8; n++ { // seven upgrades, each of an existing database
		mustOpen(t, dir, n).Close()
	}
	got := backups(t, dir)
	if len(got) != 5 {
		t.Fatalf("got %d backups, want 5: %v", len(got), got)
	}
	// The newest five come from schema versions 3..7; the two oldest are pruned.
	for _, from := range []int{3, 4, 5, 6, 7} {
		prefix := fmt.Sprintf("kestrel-%d-", from)
		found := false
		for _, g := range got {
			found = found || strings.HasPrefix(filepath.Base(g), prefix)
		}
		if !found {
			t.Errorf("no backup from schema %d in %v", from, got)
		}
	}
}

func TestBackupHoldsThePreMigrationData(t *testing.T) {
	dir := t.TempDir()
	s := mustOpen(t, dir, 1)
	if _, err := s.Write().Exec("INSERT INTO t1 DEFAULT VALUES"); err != nil {
		t.Fatal(err)
	}
	s.Close()
	mustOpen(t, dir, 2)

	b := backups(t, dir)
	if len(b) != 1 {
		t.Fatalf("backups: %v", b)
	}
	// Restoring the backup is copying it over kestrel.db: it is the old schema with the old rows.
	data, err := os.ReadFile(b[0])
	if err != nil {
		t.Fatal(err)
	}
	restored := t.TempDir()
	if err := os.WriteFile(filepath.Join(restored, "kestrel.db"), data, 0o600); err != nil {
		t.Fatal(err)
	}
	old := mustOpen(t, restored, 1)
	var n int
	if err := old.Read().QueryRow("SELECT count(*) FROM t1").Scan(&n); err != nil || n != 1 {
		t.Fatalf("backup rows = %d, err = %v", n, err)
	}
	if err := old.Read().QueryRow("SELECT count(*) FROM t2").Scan(&n); err == nil {
		t.Fatal("backup already has the migrated table")
	}
}

func TestRefusesToStartOnANewerSchema(t *testing.T) {
	dir := t.TempDir()
	mustOpen(t, dir, 1).Close()
	mustOpen(t, dir, 3).Close() // takes a backup from schema 1

	_, err := open(dir, 2) // an older binary
	if !errors.Is(err, store.ErrSchemaTooNew) {
		t.Fatalf("err = %v, want ErrSchemaTooNew", err)
	}
	if !strings.Contains(err.Error(), "kestrel-1-") {
		t.Errorf("error should name the newest backup to restore: %v", err)
	}
}
