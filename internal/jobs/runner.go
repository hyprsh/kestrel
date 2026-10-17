// Package jobs runs Kestrel's background work as state-driven reconcilers (ADR
// 0007): a small in-memory set of periodic loops, each an idempotent "find
// what is due and do it" pass over domain rows, that can be kicked awake. There
// is no job table; a restart resumes from the rows.
//
// jobs is the only package that strings modules together. It sees them through
// the small interfaces in loops.go, and cmd/kestrel (through api) hands it the
// real services.
//
// To add a loop, write its pass against an interface of the modules it needs,
// register it with Runner.Add (a name, a pass, how long to wait before the next
// one) and Kick it from wherever its trigger lives. See Downloads and Searches in
// loops.go for the two that exist.
package jobs

import (
	"context"
	"fmt"
	"log/slog"
	"slices"
	"sync"
	"time"
)

// Loop is one periodic reconciler.
type Loop struct {
	// Name identifies the loop for Kick and Pass.
	Name string
	// Run is one pass. It must be idempotent: running it again with nothing
	// changed does nothing.
	Run func(ctx context.Context) error
	// Every is how long to wait after a pass before the next one. It is read
	// after every pass, so a loop can run faster while there is work.
	Every func() time.Duration
}

type loop struct {
	Loop
	mu   sync.Mutex // one pass at a time
	kick chan struct{}
}

type startup struct {
	name string
	run  func(ctx context.Context) error
}

// Runner owns the loops.
type Runner struct {
	log *slog.Logger

	mu      sync.Mutex
	loops   map[string]*loop
	order   []string
	startup []startup
	running []string
}

// New returns a Runner. A nil logger means slog.Default().
func New(log *slog.Logger) *Runner {
	if log == nil {
		log = slog.Default()
	}
	return &Runner{log: log, loops: map[string]*loop{}}
}

// Add registers a loop. It panics on a duplicate name: that is a wiring bug.
func (r *Runner) Add(l Loop) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, dup := r.loops[l.Name]; dup {
		panic("jobs: duplicate loop " + l.Name)
	}
	r.loops[l.Name] = &loop{Loop: l, kick: make(chan struct{}, 1)}
	r.order = append(r.order, l.Name)
}

// OnStart registers startup reconciliation: work that runs once, in
// registration order, before any loop starts. A failure is logged and does not
// stop the others.
func (r *Runner) OnStart(name string, f func(ctx context.Context) error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.startup = append(r.startup, startup{name, f})
}

// Reconcile runs the startup reconciliation now.
func (r *Runner) Reconcile(ctx context.Context) {
	r.mu.Lock()
	steps := slices.Clone(r.startup)
	r.mu.Unlock()
	for _, s := range steps {
		if err := s.run(ctx); err != nil {
			r.log.Error("startup reconciliation failed", "step", s.name, "err", err)
		}
	}
}

// Kick wakes a loop for a pass now. Kicks that arrive while a pass is queued or
// running merge into one more pass. An unknown name is ignored.
func (r *Runner) Kick(name string) {
	r.mu.Lock()
	l := r.loops[name]
	r.mu.Unlock()
	if l == nil {
		return
	}
	select {
	case l.kick <- struct{}{}:
	default:
	}
}

// Pass runs one pass of a loop now and returns its error. Passes of one loop
// never overlap. Tests drive loops with it.
func (r *Runner) Pass(ctx context.Context, name string) error {
	r.mu.Lock()
	l := r.loops[name]
	r.mu.Unlock()
	if l == nil {
		return fmt.Errorf("jobs: no loop %q", name)
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	r.mark(name, true)
	defer r.mark(name, false)
	return l.Run(ctx)
}

func (r *Runner) mark(name string, on bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if on {
		r.running = append(r.running, name)
		return
	}
	if i := slices.Index(r.running, name); i >= 0 {
		r.running = slices.Delete(r.running, i, i+1)
	}
}

// Running lists the loops that are mid-pass right now (the UI's "running now").
func (r *Runner) Running() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return slices.Clone(r.running)
}

// Run does the startup reconciliation, then runs every loop until ctx ends.
// Each loop passes once at once, then again after Every or when kicked.
func (r *Runner) Run(ctx context.Context) error {
	r.Reconcile(ctx)
	r.mu.Lock()
	loops := make([]*loop, 0, len(r.order))
	for _, n := range r.order {
		loops = append(loops, r.loops[n])
	}
	r.mu.Unlock()

	var wg sync.WaitGroup
	for _, l := range loops {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r.drive(ctx, l)
		}()
	}
	wg.Wait()
	return ctx.Err()
}

func (r *Runner) drive(ctx context.Context, l *loop) {
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		case <-l.kick:
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
		}
		if err := r.Pass(ctx, l.Name); err != nil && ctx.Err() == nil {
			r.log.Error("loop pass failed", "loop", l.Name, "err", err)
		}
		timer.Reset(l.Every())
	}
}
