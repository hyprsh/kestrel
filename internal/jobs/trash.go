package jobs

import (
	"context"
	"log/slog"
	"sync"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/trashsync"
)

// Snapshots is what a TRaSH update needs of trashsync.
type Snapshots interface {
	Select(ctx context.Context) error
	Stale(ctx context.Context) (bool, error)
	NoteScored(ctx context.Context, commit string)
	AutoUpdate(ctx context.Context) (bool, error)
	Fetch(ctx context.Context) (*trashsync.Candidate, error)
	Activate(ctx context.Context, c *trashsync.Candidate)
	Reject(ctx context.Context, c *trashsync.Candidate, cause error) error
}

// TitleNames lists the Titles whose files are re-scored.
type TitleNames interface {
	Names(ctx context.Context) ([]library.Named, error)
}

// Rescorer re-scores every file of the Titles under snap, in one write, or
// changes nothing and fails.
type Rescorer interface {
	RescoreTitles(ctx context.Context, snap *scoring.Snapshot, titleIDs []int64) error
}

// TrashUpdatesDeps are what TrashUpdates needs.
type TrashUpdatesDeps struct {
	Snapshots Snapshots
	Holder    *scoring.Holder
	Library   TitleNames
	Rescorer  Rescorer
	// Enabled, when set, gates the daily check: with "Check GitHub for updates"
	// off nothing is asked of GitHub, except by a manual Update.
	Enabled func(ctx context.Context) bool
	Logger  *slog.Logger
}

// TrashUpdates strings trashsync (which fetches and activates snapshots) to
// imports (which re-scores files) so that no Grab is decided on a mix of old
// and new Scores (Settled 6): every re-score runs inside Holder.Exclusive, and
// a snapshot becomes active only after every stored file was re-scored under it.
type TrashUpdates struct {
	d  TrashUpdatesDeps
	mu sync.Mutex // one update at a time
}

// NewTrashUpdates returns a TrashUpdates.
func NewTrashUpdates(d TrashUpdatesDeps) *TrashUpdates {
	if d.Logger == nil {
		d.Logger = slog.Default()
	}
	return &TrashUpdates{d: d}
}

func (t *TrashUpdates) rescoreAll(ctx context.Context, snap *scoring.Snapshot) error {
	named, err := t.d.Library.Names(ctx)
	if err != nil {
		return err
	}
	ids := make([]int64, len(named))
	for i, n := range named {
		ids[i] = n.ID
	}
	return t.d.Rescorer.RescoreTitles(ctx, snap, ids)
}

// Start makes the newer of the downloaded and the embedded snapshot active. If
// the stored files were scored under another snapshot (a new binary embeds a
// newer one), they are re-scored under the active one before anything decides
// on them. A re-score that fails is logged and retried at the next start.
func (t *TrashUpdates) Start(ctx context.Context) error {
	if err := t.d.Snapshots.Select(ctx); err != nil {
		return err
	}
	stale, err := t.d.Snapshots.Stale(ctx)
	if err != nil || !stale {
		return err
	}
	active := t.d.Holder.Current()
	err = t.d.Holder.Exclusive(func() error { return t.rescoreAll(ctx, active) })
	if err != nil {
		t.d.Logger.Warn("re-scoring under the active TRaSH snapshot failed", "commit", active.Commit(), "err", err)
		return nil
	}
	t.d.Snapshots.NoteScored(ctx, active.Commit())
	return nil
}

// Check is the daily pass: Update, if the switch is on.
func (t *TrashUpdates) Check(ctx context.Context) error {
	if t.d.Enabled != nil && !t.d.Enabled(ctx) {
		return nil
	}
	on, err := t.d.Snapshots.AutoUpdate(ctx)
	if err != nil || !on {
		return err
	}
	_, err = t.Update(ctx)
	return err
}

// Update fetches the newest TRaSH snapshot and, if it is a different commit,
// re-scores every stored file under it and makes it active. A snapshot under
// which a stored file cannot be re-scored is rejected whole.
func (t *TrashUpdates) Update(ctx context.Context) (trashsync.Result, error) {
	t.mu.Lock()
	defer t.mu.Unlock()

	c, err := t.d.Snapshots.Fetch(ctx)
	if err != nil {
		return trashsync.Result{}, err
	}
	if c == nil {
		return trashsync.Result{Commit: t.d.Holder.Current().Commit()}, nil
	}
	err = t.d.Holder.Exclusive(func() error {
		if err := t.rescoreAll(ctx, c.Snapshot); err != nil {
			return err
		}
		t.d.Snapshots.Activate(ctx, c)
		return nil
	})
	if err != nil {
		return trashsync.Result{}, t.d.Snapshots.Reject(ctx, c, err)
	}
	return trashsync.Result{Changed: true, Commit: c.Commit()}, nil
}

// ChangeLanguage runs change, which saves a new Primary Language, and then
// re-scores every file under the active snapshot, all with no decision in
// flight. Nothing is renamed or searched.
func (t *TrashUpdates) ChangeLanguage(ctx context.Context, change func() error) error {
	return t.d.Holder.Exclusive(func() error {
		if err := change(); err != nil {
			return err
		}
		return t.rescoreAll(ctx, t.d.Holder.Current())
	})
}
