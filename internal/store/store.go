// Package store owns the SQLite connection and its migrations.
//
// The database runs in WAL mode with one write connection and a pool of read
// connections. Migrations are goose files embedded in the binary. Before an
// upgrade of an existing database the file is copied with VACUUM INTO into
// backups/, keeping the newest five. Backup takes the same copy on a schedule,
// kept apart from the upgrade ones. Kestrel never downgrades: a database
// whose schema is newer than the binary knows is refused.
package store

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/pressly/goose/v3"
	"modernc.org/sqlite" // registers the "sqlite" driver; pure Go, so CGO_ENABLED=0 works
)

const (
	dbFile      = "kestrel.db"
	backupDir   = "backups"
	keepBackups = 5
	readPool    = 8
)

//go:embed migrations/*.sql
var embedded embed.FS

// ErrSchemaTooNew is returned by Open when the database was migrated by a
// newer Kestrel than this binary.
var ErrSchemaTooNew = errors.New("database schema is newer than this Kestrel")

// Options configures Open.
type Options struct {
	// Dir is the config directory holding kestrel.db and backups/.
	Dir string
	// Migrations overrides the embedded goose migrations. Tests only.
	Migrations fs.FS
}

// Store is the open database: Write for the single write connection, Read for
// the read pool. Both are plain *sql.DB so sqlc-generated code takes either.
type Store struct {
	write *sql.DB
	read  *sql.DB
	// version is the one connection DataVersion asks.
	version *sql.DB
	// gen counts the commits per table; see Generation.
	gen *generations
	dir string
}

// Open creates the config dir if needed, migrates the database (backing it up
// first when it already holds data) and returns the pools.
func Open(ctx context.Context, opts Options) (*Store, error) {
	if err := os.MkdirAll(opts.Dir, 0o755); err != nil {
		return nil, fmt.Errorf("store: create config dir: %w", err)
	}
	path := filepath.Join(opts.Dir, dbFile)

	gen := newGenerations()
	base, err := sqlite.NewConnector(dsn(path, false))
	if err != nil {
		return nil, fmt.Errorf("store: open write connection: %w", err)
	}
	write := sql.OpenDB(hooked{base, gen})
	write.SetMaxOpenConns(1)

	migrations := opts.Migrations
	if migrations == nil {
		if migrations, err = fs.Sub(embedded, "migrations"); err != nil {
			return nil, err
		}
	}
	if err := migrate(ctx, write, migrations, opts.Dir); err != nil {
		write.Close()
		return nil, err
	}

	read, err := sql.Open("sqlite", dsn(path, true))
	if err != nil {
		write.Close()
		return nil, fmt.Errorf("store: open read pool: %w", err)
	}
	read.SetMaxOpenConns(readPool)
	// One connection that only asks PRAGMA data_version, which changes whenever another connection commits.
	version, err := sql.Open("sqlite", dsn(path, true))
	if err != nil {
		write.Close()
		read.Close()
		return nil, fmt.Errorf("store: open version connection: %w", err)
	}
	version.SetMaxOpenConns(1)
	return &Store{write: write, read: read, version: version, gen: gen, dir: opts.Dir}, nil
}

// Write is the single write connection.
func (s *Store) Write() *sql.DB { return s.write }

// Read is the read-only connection pool.
func (s *Store) Read() *sql.DB { return s.read }

// DataVersion changes whenever anything is committed to the database, by any connection of this store. A cache of what a
// full read computes is good for as long as it stays the same.
func (s *Store) DataVersion(ctx context.Context) (int64, error) {
	var v int64
	err := s.version.QueryRowContext(ctx, "PRAGMA data_version").Scan(&v)
	return v, err
}

// Close closes the pools.
func (s *Store) Close() error {
	return errors.Join(s.read.Close(), s.write.Close(), s.version.Close())
}

func dsn(path string, readOnly bool) string {
	esc := strings.NewReplacer("%", "%25", "?", "%3F", "#", "%23").Replace(path)
	q := "?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)"
	if readOnly {
		q += "&_pragma=query_only(1)"
		// The Library list and the Overview read whole tables on every request. A map of the file and a cache of a few tens
		// of megabytes make those scans memory reads instead of a pread per page (about 40 % of /titles at 4,000 Titles).
		q += "&_pragma=mmap_size(268435456)&_pragma=cache_size(-32768)"
	}
	return "file:" + esc + q
}

func migrate(ctx context.Context, db *sql.DB, migrations fs.FS, dir string) error {
	p, err := goose.NewProvider(goose.DialectSQLite3, db, migrations)
	if err != nil {
		return fmt.Errorf("store: migrations: %w", err)
	}
	sources := p.ListSources()
	if len(sources) == 0 {
		return errors.New("store: no migrations found")
	}
	latest := sources[len(sources)-1].Version
	current, err := p.GetDBVersion(ctx)
	if err != nil {
		return fmt.Errorf("store: read schema version: %w", err)
	}

	switch {
	case current > latest:
		hint := "no backup found"
		if b := newestBackup(dir); b != "" {
			hint = "restore the newest backup " + b
		}
		return fmt.Errorf("%w: database is at schema %d, this binary knows %d; run the newer release or %s",
			ErrSchemaTooNew, current, latest, hint)
	case current == latest:
		return nil
	}

	if current > 0 { // a fresh database has nothing worth backing up
		if err := backup(ctx, db, dir, current); err != nil {
			return err
		}
	}
	if err := recordInstallOrigin(ctx, db, current, latest); err != nil {
		return err
	}
	if _, err := p.Up(ctx); err != nil {
		return fmt.Errorf("store: migrate: %w", err)
	}
	return nil
}

// backup copies the database to backups/kestrel-<fromSchema>-<timestamp>.db
// and prunes all but the newest keepBackups.
func backup(ctx context.Context, db *sql.DB, dir string, from int64) error {
	bdir := filepath.Join(dir, backupDir)
	if err := os.MkdirAll(bdir, 0o755); err != nil {
		return fmt.Errorf("store: create backup dir: %w", err)
	}
	name := fmt.Sprintf("kestrel-%d-%s.db", from, time.Now().UTC().Format(stampLayout))
	if err := vacuumInto(ctx, db, filepath.Join(bdir, name)); err != nil {
		return fmt.Errorf("store: backup before migration: %w", err)
	}
	pruneBackups(dir, false, keepBackups)
	return nil
}

// stampLayout is the fixed-width timestamp that ends a backup's name.
const stampLayout = "20060102T150405.000000"

// ScheduledBackups is how many scheduled (daily) backups are kept: a week's.
const ScheduledBackups = 7

// scheduledLabel stands where an upgrade backup has its schema number.
const scheduledLabel = "daily"

func vacuumInto(ctx context.Context, db *sql.DB, target string) error {
	_, err := db.ExecContext(ctx, "VACUUM INTO '"+strings.ReplaceAll(target, "'", "''")+"'")
	return err
}

// pruneBackups deletes all but the newest keep of the scheduled or the upgrade backups.
func pruneBackups(dir string, scheduled bool, keep int) {
	n := 0
	for _, f := range Backups(dir) {
		if f.Scheduled != scheduled {
			continue
		}
		if n++; n > keep {
			_ = os.Remove(filepath.Join(dir, backupDir, f.Name))
		}
	}
}

// BackupFile is one backup in backups/.
type BackupFile struct {
	Name string
	// At is when it was taken, from its name (UTC).
	At    time.Time
	Bytes int64
	// Scheduled is true for the daily backup and false for the copy taken before an upgrade.
	Scheduled bool
}

// Backups lists the backups in dir's backups/, newest first: the copies taken before an upgrade and the scheduled ones.
func Backups(dir string) []BackupFile {
	var out []BackupFile
	for _, n := range listBackups(dir) {
		f := BackupFile{Name: n}
		parts := strings.Split(strings.TrimSuffix(n, ".db"), "-")
		if len(parts) == 3 {
			f.Scheduled = parts[1] == scheduledLabel
			f.At, _ = time.Parse(stampLayout, parts[2])
		}
		if fi, err := os.Stat(filepath.Join(dir, backupDir, n)); err == nil {
			f.Bytes = fi.Size()
		}
		out = append(out, f)
	}
	return out
}

// Backup copies the database to backups/kestrel-daily-<timestamp>.db with VACUUM INTO, the copy an upgrade
// takes, and deletes all but the newest keep scheduled backups. The copies taken before an upgrade are not
// counted and not deleted here.
func (s *Store) Backup(ctx context.Context, keep int) (BackupFile, error) {
	bdir := filepath.Join(s.dir, backupDir)
	if err := os.MkdirAll(bdir, 0o755); err != nil {
		return BackupFile{}, fmt.Errorf("store: create backup dir: %w", err)
	}
	at := time.Now().UTC()
	name := fmt.Sprintf("kestrel-%s-%s.db", scheduledLabel, at.Format(stampLayout))
	target := filepath.Join(bdir, name)
	if err := vacuumInto(ctx, s.write, target); err != nil {
		_ = os.Remove(target)
		return BackupFile{}, fmt.Errorf("store: scheduled backup: %w", err)
	}
	pruneBackups(s.dir, true, max(keep, 1))
	f := BackupFile{Name: name, At: at, Scheduled: true}
	if fi, err := os.Stat(target); err == nil {
		f.Bytes = fi.Size()
	}
	return f, nil
}

// Backups lists this database's backups, newest first.
func (s *Store) Backups() []BackupFile { return Backups(s.dir) }

// Size is the database's size on disk: the file and its write-ahead log.
func (s *Store) Size() int64 {
	var n int64
	for _, suffix := range []string{"", "-wal"} {
		if fi, err := os.Stat(filepath.Join(s.dir, dbFile+suffix)); err == nil {
			n += fi.Size()
		}
	}
	return n
}

// listBackups returns backup file names, newest first. The timestamp is fixed
// width, so ordering by it is lexical.
func listBackups(dir string) []string {
	entries, _ := os.ReadDir(filepath.Join(dir, backupDir))
	var names []string
	for _, e := range entries {
		if n := e.Name(); strings.HasPrefix(n, "kestrel-") && strings.HasSuffix(n, ".db") {
			names = append(names, n)
		}
	}
	stamp := func(n string) string { return n[strings.LastIndex(n, "-")+1:] }
	sort.Slice(names, func(i, j int) bool { return stamp(names[i]) > stamp(names[j]) })
	return names
}

func newestBackup(dir string) string {
	if names := listBackups(dir); len(names) > 0 {
		return filepath.Join(dir, backupDir, names[0])
	}
	return ""
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// freshSeedsMigration is the migration that drops the seeded Profiles and 4K Slot of a fresh install. It reads
// install_origin, so that table is recorded only when it is about to run.
const freshSeedsMigration = 51

// recordInstallOrigin tells migration 00051 whether the database is a fresh install (no schema yet) or an upgrade, as the
// table install_origin that the migration drops. The first answer stays: a run that stopped part way leaves the table, and
// the next run must not call that database an upgrade.
func recordInstallOrigin(ctx context.Context, db *sql.DB, current, latest int64) error {
	if latest < freshSeedsMigration || current >= freshSeedsMigration {
		return nil
	}
	for _, q := range []string{
		"CREATE TABLE IF NOT EXISTS install_origin (fresh INTEGER NOT NULL) STRICT",
		fmt.Sprintf("INSERT INTO install_origin (fresh) SELECT %d WHERE NOT EXISTS (SELECT 1 FROM install_origin)", boolInt(current == 0)),
	} {
		if _, err := db.ExecContext(ctx, q); err != nil {
			return fmt.Errorf("store: record install origin: %w", err)
		}
	}
	return nil
}
