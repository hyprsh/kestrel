// Package trashsync keeps Kestrel on TRaSH's latest Custom Formats and profiles
// (Settled 5 and 6). A daily check, or the manual "Update from TRaSH", fetches
// the newest snapshot and loads it all-or-nothing: it must parse, and every
// stored file must be re-scored under it in the same step, before it becomes
// the active snapshot. Any failure leaves everything as it was and raises the
// "TRaSH update rejected" Warning.
package trashsync

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"sync"
	"testing/fstest"
	"time"

	"github.com/hyprsh/kestrel/internal/health"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/settings"
)

const (
	configKey   = "trash"
	snapshotKey = "trash_snapshot"
	rejectedKey = "trash_update_rejected"
)

var (
	// ErrUnreachable means TRaSH could not be asked or downloaded from.
	ErrUnreachable = errors.New("trash: TRaSH is unreachable")
	// ErrRejected means the snapshot was refused whole.
	ErrRejected = errors.New("trash: update rejected")
)

// Ref names a commit of the TRaSH guides.
type Ref struct {
	Commit      string
	CommittedAt time.Time
}

// Source is where TRaSH's data comes from.
type Source interface {
	// Latest is the newest commit that touches the JSON Kestrel reads.
	Latest(ctx context.Context) (Ref, error)
	// Download returns the tree of that commit as scoring.LoadSnapshot reads it,
	// with COMMIT and COMMITTED_AT files.
	Download(ctx context.Context, ref Ref) (fs.FS, error)
}

// Health is what the service needs of the health module.
type Health interface {
	Raise(ctx context.Context, is health.Issue) error
	Clear(ctx context.Context, key string) error
}

// Deps are what a Service needs.
type Deps struct {
	Holder   *scoring.Holder
	Settings *settings.Settings
	Source   Source
	Health   Health
	Clock    func() time.Time
	Logger   *slog.Logger
	// Enabled, when set, gates the daily check: with "Check GitHub for updates"
	// off nothing is asked of GitHub, except by a manual Update.
	Enabled func(ctx context.Context) bool
	// Titles lists every Title id, the files of which are re-scored.
	Titles func(ctx context.Context) ([]int64, error)
	// Rescore re-scores every file of the Titles under snap and stores the result
	// in one write, or changes nothing and fails.
	Rescore func(ctx context.Context, snap *scoring.Snapshot, titleIDs []int64) error
}

// Service is the TRaSH updater.
type Service struct {
	d  Deps
	mu sync.Mutex // one update at a time
}

// New returns a Service.
func New(d Deps) *Service {
	if d.Clock == nil {
		d.Clock = time.Now
	}
	if d.Logger == nil {
		d.Logger = slog.Default()
	}
	return &Service{d: d}
}

// InTx returns a Service whose settings writes join tx, so the switch saves
// with the other settings sections. Use it for SetAutoUpdate only.
func (s *Service) InTx(tx *sql.Tx) *Service {
	d := s.d
	d.Settings = s.d.Settings.InTx(tx)
	return &Service{d: d}
}

type config struct {
	AutoUpdate *bool     `json:"auto_update,omitempty"`
	CheckedAt  time.Time `json:"checked_at,omitempty"`
}

func (s *Service) config(ctx context.Context) (config, error) {
	var c config
	raw, ok, err := s.d.Settings.Get(ctx, configKey)
	if err != nil || !ok {
		return c, err
	}
	return c, json.Unmarshal(raw, &c)
}

func (s *Service) saveConfig(ctx context.Context, c config) error {
	raw, _ := json.Marshal(c)
	return s.d.Settings.Put(ctx, configKey, raw)
}

// AutoUpdate reports whether the daily check applies updates. It is on unless
// switched off.
func (s *Service) AutoUpdate(ctx context.Context) (bool, error) {
	c, err := s.config(ctx)
	return c.AutoUpdate == nil || *c.AutoUpdate, err
}

// SetAutoUpdate switches the daily check.
func (s *Service) SetAutoUpdate(ctx context.Context, on bool) error {
	c, err := s.config(ctx)
	if err != nil {
		return err
	}
	c.AutoUpdate = &on
	return s.saveConfig(ctx, c)
}

// Status describes the active snapshot for the health strip and About.
type Status struct {
	Commit      string
	CommittedAt time.Time
	// CheckedAt is when TRaSH was last asked; zero if never.
	CheckedAt  time.Time
	AutoUpdate bool
}

// Status returns the active snapshot and the update settings.
func (s *Service) Status(ctx context.Context) Status {
	cur := s.d.Holder.Current()
	c, _ := s.config(ctx)
	return Status{
		Commit: cur.Commit(), CommittedAt: cur.CommittedAt(), CheckedAt: c.CheckedAt,
		AutoUpdate: c.AutoUpdate == nil || *c.AutoUpdate,
	}
}

type stored struct {
	Commit      string            `json:"commit"`
	CommittedAt time.Time         `json:"committed_at"`
	Files       map[string]string `json:"files"`
}

// Start makes the newer of the downloaded snapshot (if any was kept) and the
// active, embedded one the active snapshot. A kept snapshot that no longer
// loads is ignored with a log line.
func (s *Service) Start(ctx context.Context) error {
	raw, ok, err := s.d.Settings.Get(ctx, snapshotKey)
	if err != nil || !ok {
		return err
	}
	var st stored
	if err := json.Unmarshal(raw, &st); err != nil {
		s.d.Logger.Warn("the stored TRaSH snapshot is unreadable; using the embedded one", "err", err)
		return nil
	}
	if !st.CommittedAt.After(s.d.Holder.Current().CommittedAt()) {
		return nil
	}
	snap, err := scoring.LoadSnapshot(toFS(st.Files))
	if err != nil {
		s.d.Logger.Warn("the stored TRaSH snapshot does not load; using the embedded one", "err", err)
		return nil
	}
	return s.d.Holder.Exclusive(func() error { s.d.Holder.Set(snap); return nil })
}

// Result says what an Update did.
type Result struct {
	// Changed is false when TRaSH had nothing newer.
	Changed bool
	Commit  string
}

// Check is the daily pass: Update, if the switch is on.
func (s *Service) Check(ctx context.Context) error {
	if s.d.Enabled != nil && !s.d.Enabled(ctx) {
		return nil
	}
	on, err := s.AutoUpdate(ctx)
	if err != nil || !on {
		return err
	}
	_, err = s.Update(ctx)
	return err
}

// Update fetches the newest TRaSH snapshot and, if it is a different commit,
// loads it. An unreachable TRaSH is an error but not a rejection. A snapshot
// that does not load, or under which a stored file cannot be re-scored, is
// rejected whole: nothing changes and the Warning is raised.
func (s *Service) Update(ctx context.Context) (Result, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.d.Source == nil {
		return Result{}, fmt.Errorf("%w: no source is configured", ErrUnreachable)
	}
	ref, err := s.d.Source.Latest(ctx)
	if err != nil {
		return Result{}, fmt.Errorf("%w: asking for the latest commit: %v", ErrUnreachable, err)
	}
	s.noteCheck(ctx)
	if ref.Commit == s.d.Holder.Current().Commit() {
		s.clearRejected(ctx)
		return Result{Commit: ref.Commit}, nil
	}
	files, err := s.d.Source.Download(ctx, ref)
	if err != nil {
		return Result{}, fmt.Errorf("%w: downloading %s: %v", ErrUnreachable, short(ref.Commit), err)
	}
	snap, err := scoring.LoadSnapshot(files)
	if err != nil {
		return Result{}, s.reject(ctx, ref, err)
	}
	ids, err := s.d.Titles(ctx)
	if err != nil {
		return Result{}, err
	}
	err = s.d.Holder.Exclusive(func() error {
		if err := s.d.Rescore(ctx, snap, ids); err != nil {
			return err
		}
		s.d.Holder.Set(snap)
		return nil
	})
	if err != nil {
		return Result{}, s.reject(ctx, ref, err)
	}
	if err := s.keep(ctx, files, ref); err != nil {
		s.d.Logger.Error("keeping the TRaSH snapshot failed; it is active until restart", "err", err)
	}
	s.clearRejected(ctx)
	s.d.Logger.Info("TRaSH updated", "commit", short(ref.Commit))
	return Result{Changed: true, Commit: ref.Commit}, nil
}

// ChangeLanguage runs change, which saves a new Primary Language, and then
// re-scores every file under the active snapshot, all with no decision in
// flight. Nothing is renamed or searched.
func (s *Service) ChangeLanguage(ctx context.Context, change func() error) error {
	return s.d.Holder.Exclusive(func() error {
		if err := change(); err != nil {
			return err
		}
		ids, err := s.d.Titles(ctx)
		if err != nil {
			return err
		}
		return s.d.Rescore(ctx, s.d.Holder.Current(), ids)
	})
}

func (s *Service) noteCheck(ctx context.Context) {
	c, err := s.config(ctx)
	if err == nil {
		c.CheckedAt = s.d.Clock().UTC()
		err = s.saveConfig(ctx, c)
	}
	if err != nil {
		s.d.Logger.Warn("recording the TRaSH check failed", "err", err)
	}
}

func (s *Service) reject(ctx context.Context, ref Ref, cause error) error {
	err := fmt.Errorf("%w: update to %s: %v", ErrRejected, short(ref.Commit), cause)
	if s.d.Health != nil {
		if herr := s.d.Health.Raise(ctx, health.Issue{
			Key: rejectedKey, Kind: health.KindTrashRejected, Severity: health.Warning,
			Message: fmt.Sprintf("TRaSH update %s was rejected and the previous Custom Formats stay in use: %v", short(ref.Commit), cause),
		}); herr != nil {
			s.d.Logger.Warn("raising the TRaSH update rejected Warning failed", "err", herr)
		}
	}
	s.d.Logger.Warn("TRaSH update rejected", "commit", short(ref.Commit), "err", cause)
	return err
}

func (s *Service) clearRejected(ctx context.Context) {
	if s.d.Health != nil {
		_ = s.d.Health.Clear(ctx, rejectedKey)
	}
}

func (s *Service) keep(ctx context.Context, files fs.FS, ref Ref) error {
	st := stored{Commit: ref.Commit, CommittedAt: ref.CommittedAt, Files: map[string]string{}}
	err := fs.WalkDir(files, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		b, err := fs.ReadFile(files, p)
		st.Files[p] = string(b)
		return err
	})
	if err != nil {
		return err
	}
	raw, err := json.Marshal(st)
	if err != nil {
		return err
	}
	return s.d.Settings.Put(ctx, snapshotKey, raw)
}

func short(commit string) string {
	if len(commit) > 7 {
		return commit[:7]
	}
	return commit
}

func toFS(files map[string]string) fs.FS {
	m := make(fstest.MapFS, len(files))
	for p, c := range files {
		m[p] = &fstest.MapFile{Data: []byte(c)}
	}
	return m
}
