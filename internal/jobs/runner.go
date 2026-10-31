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
	// after every pass, so a loop can run faster while there is work. Nil
	// means Schedule.Every.
	Every func() time.Duration
	// Schedule is how often the loop runs, in words the UI can show.
	Schedule Schedule
}

// Schedule is a loop's cadence as the UI shows it.
type Schedule struct {
	// Every is the wait between passes.
	Every time.Duration
	// Busy, when set, is the shorter wait while there is work (Poll while a Grab downloads).
	Busy time.Duration
	// Runs, when set, is how often a pass does its work: one checked Every
	// does it once the last run is Runs old (the daily loops).
	Runs time.Duration
}

type loop struct {
	Loop
	mu   sync.Mutex // one pass at a time
	kick chan struct{}
	// state is guarded by Runner.mu.
	state loopState
}

// loopState is what the runner remembers of a loop between passes, in memory
// only (ADR 0007): the UI reads it to say what runs when.
type loopState struct {
	// started is when the pass running now started; zero between passes.
	started time.Time
	// next is when the next pass is due: zero while one runs and before Run.
	next time.Time
	// last is the last pass that finished; nil until the first does.
	last *PassResult
	// progress is how far the pass running now has got, if it says; nil between passes.
	progress *Progress
	// outcome is the last outcome a pass reported; nil until one does.
	outcome *Outcome
}

// PassResult is how one pass of a loop went.
type PassResult struct {
	StartedAt, FinishedAt time.Time
	// Took is FinishedAt less StartedAt.
	Took time.Duration
	// Err is the error the pass returned; empty when it succeeded.
	Err string
}

// Job is a loop as the runner knows it now: whether it is mid-pass, how its
// last pass went and when the next is due.
type Job struct {
	Name    string
	Running bool
	// Last is nil until the first pass since start ends.
	Last *PassResult
	// Next is zero while a pass runs and before the loops start; a kick starts one sooner.
	Next     time.Time
	Schedule Schedule
	// Progress is how far the pass running now has got; nil between passes and for
	// a loop that does not say.
	Progress *Progress
	// Outcome is the last outcome a pass reported; nil until one does.
	Outcome *Outcome
}

type startup struct {
	name string
	run  func(ctx context.Context) error
}

// Runner owns the loops.
type Runner struct {
	log   *slog.Logger
	clock func() time.Time

	mu      sync.Mutex
	loops   map[string]*loop
	order   []string
	startup []startup
	stop    []func()
	search  *searchTracker
	// recount refreshes the Search status's due counts; nil without a Search loop.
	recount func(ctx context.Context) error
}

// New returns a Runner. A nil logger means slog.Default().
func New(log *slog.Logger) *Runner {
	if log == nil {
		log = slog.Default()
	}
	return &Runner{log: log, clock: time.Now, loops: map[string]*loop{}, search: &searchTracker{}}
}

// Add registers a loop. It panics on a duplicate name: that is a wiring bug.
func (r *Runner) Add(l Loop) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, dup := r.loops[l.Name]; dup {
		panic("jobs: duplicate loop " + l.Name)
	}
	if l.Every == nil {
		every := l.Schedule.Every
		l.Every = func() time.Duration { return every }
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

// OnStop registers shutdown work: it runs once, in registration order, after
// Run's loops have stopped, and Run returns when it is done. Background work
// that is not a loop (Search now) stops there.
func (r *Runner) OnStop(f func()) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.stop = append(r.stop, f)
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
	start := r.clock()
	r.mu.Lock()
	l.state.started, l.state.progress = start, nil
	r.mu.Unlock()
	err := l.Run(withReporter(ctx, r, l))
	end := r.clock()
	p := &PassResult{StartedAt: start, FinishedAt: end, Took: end.Sub(start)}
	if err != nil {
		p.Err = err.Error()
	}
	r.mu.Lock()
	l.state.started, l.state.last, l.state.progress = time.Time{}, p, nil
	r.mu.Unlock()
	return err
}

// Run is a pass in flight: its loop and when it started.
type Run struct {
	Name  string
	Since time.Time
}

// Running lists the loops that are mid-pass right now (the UI's "running now"),
// the longest-running first.
func (r *Runner) Running() []Run {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []Run
	for _, n := range r.order {
		if s := r.loops[n].state.started; !s.IsZero() {
			out = append(out, Run{n, s})
		}
	}
	slices.SortStableFunc(out, func(a, b Run) int { return a.Since.Compare(b.Since) })
	return out
}

// Jobs lists the loops in registration order, each with its last pass and
// when the next is due. It is in memory only, so it starts empty at every start.
func (r *Runner) Jobs() []Job {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]Job, 0, len(r.order))
	for _, n := range r.order {
		l := r.loops[n]
		j := Job{Name: n, Running: !l.state.started.IsZero(), Next: l.state.next, Schedule: l.Schedule}
		if l.state.last != nil {
			p := *l.state.last
			j.Last = &p
		}
		if p := l.state.progress; p != nil {
			c := *p
			j.Progress = &c
		}
		if o := l.state.outcome; o != nil {
			c := *o
			j.Outcome = &c
		}
		out = append(out, j)
	}
	return out
}

// Run does the startup reconciliation, then runs every loop until ctx ends,
// then the shutdown work. Each loop passes once at once, then again after
// Every or when kicked.
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
	if r.recount != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r.recountEvery(ctx, dueRecount)
		}()
	}
	wg.Wait()
	r.mu.Lock()
	stop := slices.Clone(r.stop)
	r.mu.Unlock()
	for _, f := range stop {
		f()
	}
	return ctx.Err()
}

// RecountDue recounts what waits for the Search loop, so the Search status
// stays current between passes. A pass running now keeps its own count, so it
// does nothing then.
func (r *Runner) RecountDue(ctx context.Context) error {
	r.mu.Lock()
	l := r.loops[Search]
	r.mu.Unlock()
	if r.recount == nil || l == nil || !l.mu.TryLock() {
		return nil
	}
	defer l.mu.Unlock()
	return r.recount(ctx)
}

func (r *Runner) recountEvery(ctx context.Context, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := r.RecountDue(ctx); err != nil && ctx.Err() == nil {
				r.log.Warn("recounting what is due a search failed", "err", err)
			}
		}
	}
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
		r.setNext(l, time.Time{})
		if err := r.Pass(ctx, l.Name); err != nil && ctx.Err() == nil {
			r.log.Error("loop pass failed", "loop", l.Name, "err", err)
		}
		every := l.Every()
		r.setNext(l, r.clock().Add(every))
		timer.Reset(every)
	}
}

func (r *Runner) setNext(l *loop, at time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	l.state.next = at
}

// next is when a loop's next pass is due; zero while one runs, before Run and
// for an unknown loop.
func (r *Runner) next(name string) time.Time {
	r.mu.Lock()
	defer r.mu.Unlock()
	if l := r.loops[name]; l != nil {
		return l.state.next
	}
	return time.Time{}
}
