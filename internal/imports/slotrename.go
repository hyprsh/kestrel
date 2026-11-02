package imports

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/hyprsh/kestrel/internal/health"
	"github.com/hyprsh/kestrel/internal/imports/db"
	"github.com/hyprsh/kestrel/internal/store"
)

// SlotRenamerHealth is what the SlotRenamer needs of the health module.
type SlotRenamerHealth interface {
	Raise(ctx context.Context, is health.Issue) error
	Clear(ctx context.Context, key string) error
}

// SlotRenamerDeps are what NewSlotRenamer needs.
type SlotRenamerDeps struct {
	Store *store.Store
	// Rename renames the files of the Slot's Titles after its current label,
	// telling progress how many Titles are done of how many (Service.RenameSlotProgress).
	Rename func(ctx context.Context, id Slot, progress func(done, total int)) (int, error)
	// Label is the Slot's label, for the Activity screen (Service.SlotLabel).
	Label func(ctx context.Context, id Slot) (string, error)
	// Health is optional; without it failures are only logged.
	Health SlotRenamerHealth
	// Clock defaults to time.Now.
	Clock  func() time.Time
	Logger *slog.Logger
}

// SlotRenameProgress is one Slot's rename job as the Activity screen shows it.
type SlotRenameProgress struct {
	Slot  Slot
	Label string
	// Done of Total Titles are renamed; Total is 0 until the job has counted them.
	Done, Total int
}

// SlotRenamer runs the file renames a Slot's new label calls for (ADR 0024) in
// the background. A job is a row in slot_renames from the moment the label is
// saved until every Title has followed it, so a restart picks it up again
// (Rename is idempotent). Never two jobs for one Slot run at once: relabeling
// a Slot whose job runs makes that job go once more when it is through.
type SlotRenamer struct {
	d SlotRenamerDeps
	q *db.Queries

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup

	mu      sync.Mutex
	running map[Slot]*slotRun
	closed  bool
}

type slotRun struct{ again bool }

// NewSlotRenamer returns a SlotRenamer. Call Resume to pick up the jobs a
// restart interrupted.
func NewSlotRenamer(d SlotRenamerDeps) *SlotRenamer {
	if d.Clock == nil {
		d.Clock = time.Now
	}
	if d.Logger == nil {
		d.Logger = slog.Default()
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &SlotRenamer{d: d, q: db.New(d.Store.Write()), ctx: ctx, cancel: cancel, running: map[Slot]*slotRun{}}
}

// Resume starts the jobs that were left unfinished. It returns at once.
func (r *SlotRenamer) Resume(ctx context.Context) error {
	rows, err := db.New(r.d.Store.Read()).ListSlotRenames(ctx)
	if err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, row := range rows {
		r.startLocked(Slot(row.SlotID))
	}
	return nil
}

// Enqueue stores the job and starts it in the background; it returns once the
// job is stored, never waiting for a file. A job already running for the Slot
// goes once more when it finishes.
func (r *SlotRenamer) Enqueue(ctx context.Context, id Slot) error {
	label := string(id)
	if r.d.Label != nil {
		if l, err := r.d.Label(ctx, id); err == nil {
			label = l
		}
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return context.Canceled
	}
	if err := r.q.QueueSlotRename(ctx, db.QueueSlotRenameParams{SlotID: string(id), Label: label, QueuedAt: r.d.Clock().UTC().Format(time.RFC3339)}); err != nil {
		return err
	}
	if run, ok := r.running[id]; ok {
		run.again = true
		return nil
	}
	r.startLocked(id)
	return nil
}

// Active lists the jobs not finished yet, oldest first.
func (r *SlotRenamer) Active(ctx context.Context) ([]SlotRenameProgress, error) {
	rows, err := db.New(r.d.Store.Read()).ListSlotRenames(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]SlotRenameProgress, len(rows))
	for i, row := range rows {
		out[i] = SlotRenameProgress{Slot: Slot(row.SlotID), Label: row.Label, Done: int(row.Done), Total: int(row.Total)}
	}
	return out, nil
}

// Close cuts off the jobs running and waits for them. Their rows stay, so the
// next start resumes them.
func (r *SlotRenamer) Close() {
	r.mu.Lock()
	r.closed = true
	r.mu.Unlock()
	r.cancel()
	r.wg.Wait()
}

// startLocked starts the job of a Slot that has none running; r.mu is held.
func (r *SlotRenamer) startLocked(id Slot) {
	if r.closed {
		return
	}
	if _, ok := r.running[id]; ok {
		return
	}
	r.running[id] = &slotRun{}
	r.wg.Add(1)
	go r.run(id)
}

func (r *SlotRenamer) run(id Slot) {
	defer r.wg.Done()
	for {
		r.once(id)
		r.mu.Lock()
		run := r.running[id]
		if r.ctx.Err() != nil {
			delete(r.running, id) // interrupted: the row stays for the next start
			r.mu.Unlock()
			return
		}
		if run.again {
			run.again = false
			r.mu.Unlock()
			continue
		}
		// Under the lock, so an Enqueue cannot store a job between the check and the delete.
		if err := r.q.DeleteSlotRename(context.WithoutCancel(r.ctx), string(id)); err != nil {
			r.d.Logger.Warn("slot rename: clearing the finished job failed", "slot", string(id), "err", err)
		}
		delete(r.running, id)
		r.mu.Unlock()
		return
	}
}

// once renames the Slot's files once and raises or clears the Health warning.
func (r *SlotRenamer) once(id Slot) {
	ctx := r.ctx
	key := "slot_rename_failed:" + string(id)
	progress := func(done, total int) {
		if err := r.q.SetSlotRenameProgress(ctx, db.SetSlotRenameProgressParams{Done: int64(done), Total: int64(total), SlotID: string(id)}); err != nil && ctx.Err() == nil {
			r.d.Logger.Warn("slot rename: saving progress failed", "slot", string(id), "err", err)
		}
	}
	files, err := r.d.Rename(ctx, id, progress)
	switch {
	case ctx.Err() != nil:
		return
	case err != nil:
		r.d.Logger.Warn("renaming a Slot's files after its label changed failed", "slot", string(id), "err", err)
		if r.d.Health != nil {
			label := string(id)
			if r.d.Label != nil {
				if l, lerr := r.d.Label(ctx, id); lerr == nil {
					label = l
				}
			}
			is := health.Issue{
				Key: key, Kind: health.KindSlotRenameFailed, Severity: health.Warning, Dismissible: true,
				Message: fmt.Sprintf("Some files of the Slot %s were not renamed after its label changed: %s", label, err),
			}
			if rerr := r.d.Health.Raise(ctx, is); rerr != nil {
				r.d.Logger.Warn("raising a Slot rename warning failed", "slot", string(id), "err", rerr)
			}
		}
	default:
		r.d.Logger.Info("renamed a Slot's files after its label changed", "slot", string(id), "files", files)
		if r.d.Health != nil {
			if cerr := r.d.Health.Clear(ctx, key); cerr != nil {
				r.d.Logger.Warn("clearing a Slot rename warning failed", "slot", string(id), "err", cerr)
			}
		}
	}
}
