// Package trashsync keeps Kestrel on TRaSH's latest Custom Formats and profiles
// (Settled 5 and 6). A daily check, or the manual "Update from TRaSH", fetches
// the newest snapshot and loads it all-or-nothing: it must parse, and every
// stored file must be re-scored under it in the same step, before it becomes
// the active snapshot. Any failure leaves everything as it was and raises the
// "TRaSH update rejected" Warning.
//
// trashsync only fetches, keeps and activates snapshots. It never calls the
// modules that score files: the jobs module drives an update, re-scoring
// through imports between Fetch and Activate (see jobs.TrashUpdates).
package trashsync

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
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
	// scoredKey holds the commit of the snapshot the stored files were last scored under.
	scoredKey = "trash_scored"
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
}

// Service keeps the TRaSH snapshots.
type Service struct{ d Deps }

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

// Select makes the newer of the downloaded snapshot (if any was kept) and the
// active, embedded one the active snapshot. A kept snapshot that no longer
// loads is ignored with a log line. Call it before anything decides on Scores,
// then Stale to see whether the stored files need re-scoring.
func (s *Service) Select(ctx context.Context) error {
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

// Stale reports whether the stored files were scored under another snapshot
// than the active one (a new binary embeds a newer one): they must be
// re-scored, and NoteScored called after.
func (s *Service) Stale(ctx context.Context) (bool, error) {
	raw, ok, err := s.d.Settings.Get(ctx, scoredKey)
	if err != nil {
		return false, err
	}
	var scored string
	if ok {
		_ = json.Unmarshal(raw, &scored)
	}
	return scored != s.d.Holder.Current().Commit(), nil
}

// NoteScored remembers which snapshot the stored files are scored under.
func (s *Service) NoteScored(ctx context.Context, commit string) {
	raw, _ := json.Marshal(commit)
	if err := s.d.Settings.Put(ctx, scoredKey, raw); err != nil {
		s.d.Logger.Warn("recording the TRaSH snapshot the files are scored under failed", "err", err)
	}
}

// Result says what an Update did.
type Result struct {
	// Changed is false when TRaSH had nothing newer.
	Changed bool
	Commit  string
}

// Candidate is a downloaded snapshot that loads and is not active yet.
type Candidate struct {
	// Snapshot is what the stored files must be re-scored under.
	Snapshot *scoring.Snapshot
	ref      Ref
	files    fs.FS
}

// Commit is the TRaSH commit of the snapshot.
func (c *Candidate) Commit() string { return c.ref.Commit }

// Fetch asks for the newest TRaSH snapshot and returns it unless it is the
// active commit already (then nil). An unreachable TRaSH is an error but not a
// rejection; a snapshot that does not load is rejected: nothing changes and the
// Warning is raised. The caller re-scores every stored file under
// Candidate.Snapshot inside scoring.Holder.Exclusive and then calls Activate,
// or Reject if that fails.
func (s *Service) Fetch(ctx context.Context) (*Candidate, error) {
	if s.d.Source == nil {
		return nil, fmt.Errorf("%w: no source is configured", ErrUnreachable)
	}
	ref, err := s.d.Source.Latest(ctx)
	if err != nil {
		return nil, fmt.Errorf("%w: asking for the latest commit: %v", ErrUnreachable, err)
	}
	s.noteCheck(ctx)
	if ref.Commit == s.d.Holder.Current().Commit() {
		s.clearRejected(ctx)
		return nil, nil
	}
	files, err := s.d.Source.Download(ctx, ref)
	if err != nil {
		return nil, fmt.Errorf("%w: downloading %s: %v", ErrUnreachable, short(ref.Commit), err)
	}
	snap, err := scoring.LoadSnapshot(files)
	if err != nil {
		return nil, s.Reject(ctx, &Candidate{ref: ref}, err)
	}
	return &Candidate{Snapshot: snap, ref: ref, files: files}, nil
}

// Activate makes the candidate the active snapshot and keeps it for restarts.
// Call it inside scoring.Holder.Exclusive, after every stored file was
// re-scored under it.
func (s *Service) Activate(ctx context.Context, c *Candidate) {
	s.d.Holder.Set(c.Snapshot)
	s.NoteScored(ctx, c.ref.Commit)
	if err := s.keep(ctx, c.files, c.ref); err != nil {
		s.d.Logger.Error("keeping the TRaSH snapshot failed; it is active until restart", "err", err)
	}
	s.clearRejected(ctx)
	s.d.Logger.Info("TRaSH updated", "commit", short(c.ref.Commit))
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

// Reject refuses the candidate whole: it returns ErrRejected, raises the
// "TRaSH update rejected" Warning and leaves everything as it was.
func (s *Service) Reject(ctx context.Context, c *Candidate, cause error) error {
	ref := c.ref
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
