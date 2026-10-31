package jobs

import (
	"context"
	"errors"
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
	// progress, if not nil, is told how many Titles are re-scored as it goes.
	RescoreTitles(ctx context.Context, snap *scoring.Snapshot, titleIDs []int64, progress func(done int)) error
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

	// reqMu guards what was asked for by hand and not done yet, and what the
	// pass running now does, so a second request for the same work starts nothing.
	reqMu     sync.Mutex
	pending   request
	running   request
	onRequest func()
}

// request is the work a pass is asked to do beyond the daily check.
type request struct {
	update   bool // "Update from TRaSH"
	language bool // a Primary Language change saved: re-score under it
}

// NewTrashUpdates returns a TrashUpdates.
func NewTrashUpdates(d TrashUpdatesDeps) *TrashUpdates {
	if d.Logger == nil {
		d.Logger = slog.Default()
	}
	return &TrashUpdates{d: d}
}

// OnRequest sets what wakes the trash loop when work is requested. Work
// requested before it is set waits for the loop's next pass.
func (t *TrashUpdates) OnRequest(f func()) {
	t.reqMu.Lock()
	defer t.reqMu.Unlock()
	t.onRequest = f
}

// request asks for work and wakes the loop, unless the same work is already
// waiting or running; it reports whether it asked.
func (t *TrashUpdates) request(r request) bool {
	t.reqMu.Lock()
	if (r.update && (t.pending.update || t.running.update)) || (r.language && t.pending.language) {
		t.reqMu.Unlock()
		return false
	}
	t.pending.update = t.pending.update || r.update
	t.pending.language = t.pending.language || r.language
	wake := t.onRequest
	t.reqMu.Unlock()
	if wake != nil {
		wake()
	}
	return true
}

// RequestUpdate asks the trash loop for an "Update from TRaSH" pass, whatever
// the daily check's switches say, and returns at once. It reports false, and
// asks for nothing, when one is already waiting or running.
func (t *TrashUpdates) RequestUpdate() bool { return t.request(request{update: true}) }

// RunRequested does what was requested by hand since the last pass, if
// anything, and reports whether there was any. It is the trash loop's pass for
// a kick; without a request the loop runs its daily check instead.
func (t *TrashUpdates) RunRequested(ctx context.Context) (bool, error) {
	t.reqMu.Lock()
	want := t.pending
	t.pending, t.running = request{}, want
	t.reqMu.Unlock()
	if want == (request{}) {
		return false, nil
	}
	defer func() {
		t.reqMu.Lock()
		t.running = request{}
		t.reqMu.Unlock()
	}()
	var err error
	if want.language {
		err = t.rescoreLanguage(ctx)
	}
	if want.update {
		if _, uerr := t.Update(ctx); err == nil {
			err = uerr
		}
	}
	return true, err
}

func (t *TrashUpdates) rescoreLanguage(ctx context.Context) error {
	err := t.d.Holder.Exclusive(func() error { return t.rescoreAll(ctx, t.d.Holder.Current()) })
	if err != nil {
		t.d.Logger.Warn("re-scoring after the Primary Language change failed", "err", err)
		ReportOutcome(ctx, OutcomeFailed, "Re-scoring after the Primary Language change failed: "+err.Error())
		return err
	}
	ReportOutcome(ctx, OutcomeRescored, "Re-scored every file under the new Primary Language")
	return nil
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
	ReportProgress(ctx, 0, len(ids))
	return t.d.Rescorer.RescoreTitles(ctx, snap, ids, func(done int) { ReportProgress(ctx, done, len(ids)) })
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
// which a stored file cannot be re-scored is rejected whole. Under a loop's
// pass it reports how it went (ReportOutcome).
func (t *TrashUpdates) Update(ctx context.Context) (trashsync.Result, error) {
	t.mu.Lock()
	defer t.mu.Unlock()

	res, err := t.update(ctx)
	switch {
	case errors.Is(err, trashsync.ErrUnreachable):
		ReportOutcome(ctx, OutcomeUnreachable, "Could not reach TRaSH. Try again later.")
	case errors.Is(err, trashsync.ErrRejected):
		ReportOutcome(ctx, OutcomeRejected, "TRaSH’s newest set was rejected. The previous one stays in use.")
	case err != nil:
		ReportOutcome(ctx, OutcomeFailed, "Updating from TRaSH failed: "+err.Error())
	case res.Changed:
		ReportOutcome(ctx, OutcomeUpdated, "Updated to TRaSH commit "+short(res.Commit))
	default:
		ReportOutcome(ctx, OutcomeUpToDate, "Already up to date with TRaSH")
	}
	return res, err
}

func short(commit string) string {
	if len(commit) > 7 {
		return commit[:7]
	}
	return commit
}

func (t *TrashUpdates) update(ctx context.Context) (trashsync.Result, error) {
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

// ChangeLanguage runs change, which saves a new Primary Language, with no
// decision in flight, and asks the trash loop to re-score every file under it
// in the background. Nothing is renamed or searched. Until that pass ends, files
// keep their old Scores.
func (t *TrashUpdates) ChangeLanguage(ctx context.Context, change func() error) error {
	if err := t.d.Holder.Exclusive(change); err != nil {
		return err
	}
	t.request(request{language: true})
	return nil
}
