package jobs

import (
	"context"
	"errors"
	"fmt"
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
	// pass running now does. A second "Update from TRaSH" while one waits or
	// runs starts nothing; a Language change while a re-score runs waits for
	// the next pass.
	reqMu     sync.Mutex
	pending   request
	running   request
	onRequest func()
}

// request is the work a pass is asked to do beyond the daily check.
type request struct {
	update   bool            // "Update from TRaSH"
	language *LanguageChange // a Primary Language change to save and re-score under
}

// LanguageChange is a Primary Language change that waits for its pass. The
// pass saves it and re-scores every file in one Holder.Exclusive step.
type LanguageChange struct {
	// Language is the new Primary Language, as Settings reports it while pending.
	Language string
	// Apply saves the new Primary Language and what follows from it. It gets the
	// pass's context: the request that queued the change is long gone.
	Apply func(ctx context.Context) error
	// Undo puts back what Apply saved, when the re-score fails.
	Undo func(ctx context.Context) error
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
	if r.update && (t.pending.update || t.running.update) && r.language == nil {
		t.reqMu.Unlock()
		return false
	}
	t.pending.update = t.pending.update || r.update
	if r.language != nil {
		t.pending.language = r.language // a second change replaces the one waiting
	}
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
	if !want.update && want.language == nil {
		return false, nil
	}
	defer func() {
		t.reqMu.Lock()
		t.running = request{}
		t.reqMu.Unlock()
	}()
	var err error
	if want.language != nil {
		err = t.rescoreLanguage(ctx, want.language)
	}
	if want.update {
		if _, uerr := t.Update(ctx); err == nil {
			err = uerr
		}
	}
	return true, err
}

// ApplyLanguage saves a Primary Language and re-scores every file under it in
// one step, and returns when both are done, or when neither is. It is for the
// Config File at startup, which has no pass to wait for.
func (t *TrashUpdates) ApplyLanguage(ctx context.Context, c LanguageChange) error {
	return t.d.Holder.Exclusive(func() error { return t.saveAndRescore(ctx, &c) })
}

// saveAndRescore is the step of Settled 6: it saves the new Primary Language
// and re-scores every file under it, and if the re-score fails undoes the save,
// so the setting and the Scores still agree. Call it inside Holder.Exclusive.
func (t *TrashUpdates) saveAndRescore(ctx context.Context, c *LanguageChange) error {
	if err := c.Apply(ctx); err != nil {
		return err
	}
	err := t.rescoreAll(ctx, t.d.Holder.Current())
	if err != nil {
		if uerr := c.Undo(ctx); uerr != nil {
			err = errors.Join(err, fmt.Errorf("undoing the Primary Language change: %w", uerr))
		}
	}
	return err
}

func (t *TrashUpdates) rescoreLanguage(ctx context.Context, c *LanguageChange) error {
	err := t.d.Holder.Exclusive(func() error { return t.saveAndRescore(ctx, c) })
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

// ChangeLanguage queues a new Primary Language and wakes the trash loop, and
// returns at once. The pass saves it and re-scores every file under it in one
// step, so until the pass ends both the setting and the Scores are the old
// ones. Nothing is renamed or searched. A change queued while another waits
// replaces it.
func (t *TrashUpdates) ChangeLanguage(_ context.Context, c LanguageChange) {
	t.request(request{language: &c})
}

// PendingLanguage is the Primary Language that is queued or being re-scored
// now, if any.
func (t *TrashUpdates) PendingLanguage() (string, bool) {
	t.reqMu.Lock()
	defer t.reqMu.Unlock()
	switch {
	case t.pending.language != nil:
		return t.pending.language.Language, true
	case t.running.language != nil:
		return t.running.language.Language, true
	}
	return "", false
}
