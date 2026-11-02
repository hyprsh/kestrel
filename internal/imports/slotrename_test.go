package imports_test

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/hyprsh/kestrel/internal/health"
	"github.com/hyprsh/kestrel/internal/imports"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/store/storetest"
)

// fakeRenamer renames "Titles" one by one, blocking on gate when it is set.
type fakeRenamer struct {
	mu      sync.Mutex
	titles  int
	gate    chan struct{}
	started chan struct{}
	fail    error
	runs    map[imports.Slot]int
	running map[imports.Slot]int
	overlap bool
}

func (f *fakeRenamer) rename(ctx context.Context, id imports.Slot, progress func(done, total int)) (int, error) {
	f.mu.Lock()
	f.runs[id]++
	f.running[id]++
	if f.running[id] > 1 {
		f.overlap = true
	}
	gate, started, fail := f.gate, f.started, f.fail
	f.mu.Unlock()
	defer func() {
		f.mu.Lock()
		f.running[id]--
		f.mu.Unlock()
	}()
	progress(0, f.titles)
	if started != nil {
		select {
		case started <- struct{}{}:
		default:
		}
	}
	if gate != nil {
		select {
		case <-gate:
		case <-ctx.Done():
			return 0, ctx.Err()
		}
	}
	progress(f.titles, f.titles)
	return f.titles, fail
}

func (f *fakeRenamer) count(id imports.Slot) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.runs[id]
}

func newFakeRenamer(titles int) *fakeRenamer {
	return &fakeRenamer{titles: titles, runs: map[imports.Slot]int{}, running: map[imports.Slot]int{}}
}

func slotRenamerOver(t *testing.T, st *store.Store, f *fakeRenamer, h imports.SlotRenamerHealth) *imports.SlotRenamer {
	t.Helper()
	r := imports.NewSlotRenamer(imports.SlotRenamerDeps{
		Store: st, Rename: f.rename, Health: h,
		Label: func(context.Context, imports.Slot) (string, error) { return "Original", nil },
	})
	t.Cleanup(r.Close)
	return r
}

func openStore(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.Open(context.Background(), store.Options{Dir: storetest.Dir(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func TestEnqueueReturnsWithoutWaitingForTheFilesAndTheJobShowsItsProgress(t *testing.T) {
	st := openStore(t)
	f := newFakeRenamer(7)
	f.gate = make(chan struct{})
	f.started = make(chan struct{}, 1)
	r := slotRenamerOver(t, st, f, nil)

	if err := r.Enqueue(context.Background(), "standard"); err != nil {
		t.Fatal(err)
	}
	<-f.started
	jobs, err := r.Active(context.Background())
	if err != nil || len(jobs) != 1 || jobs[0].Slot != "standard" || jobs[0].Label != "Original" || jobs[0].Total != 7 {
		t.Fatalf("active %+v, %v", jobs, err)
	}
	close(f.gate)
	waitFor(t, func() bool {
		jobs, _ := r.Active(context.Background())
		return len(jobs) == 0
	})
}

func TestAJobInterruptedMidWayFinishesAfterARestart(t *testing.T) {
	st := openStore(t)
	f := newFakeRenamer(3)
	f.gate = make(chan struct{})
	f.started = make(chan struct{}, 1)
	first := imports.NewSlotRenamer(imports.SlotRenamerDeps{Store: st, Rename: f.rename})
	if err := first.Enqueue(context.Background(), "standard"); err != nil {
		t.Fatal(err)
	}
	<-f.started
	first.Close() // the process stops mid-job
	jobs, _ := first.Active(context.Background())
	if len(jobs) != 1 {
		t.Fatalf("the interrupted job is gone: %+v", jobs)
	}

	g := newFakeRenamer(3)
	second := slotRenamerOver(t, st, g, nil)
	if err := second.Resume(context.Background()); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return g.count("standard") == 1 })
	waitFor(t, func() bool {
		jobs, _ := second.Active(context.Background())
		return len(jobs) == 0
	})
}

func TestRelabelingWhileTheJobRunsRunsItAgainNeverTwoAtOnce(t *testing.T) {
	st := openStore(t)
	f := newFakeRenamer(2)
	f.gate = make(chan struct{})
	f.started = make(chan struct{}, 1)
	r := slotRenamerOver(t, st, f, nil)
	if err := r.Enqueue(context.Background(), "standard"); err != nil {
		t.Fatal(err)
	}
	<-f.started
	if err := r.Enqueue(context.Background(), "standard"); err != nil {
		t.Fatal(err)
	}
	close(f.gate)
	waitFor(t, func() bool { return f.count("standard") == 2 })
	waitFor(t, func() bool {
		jobs, _ := r.Active(context.Background())
		return len(jobs) == 0
	})
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.overlap {
		t.Fatal("two jobs ran for one Slot at once")
	}
}

func TestATitleThatFailsRaisesAHealthWarningAndASuccessClearsIt(t *testing.T) {
	st := openStore(t)
	f := newFakeRenamer(2)
	f.fail = errors.New("title 9: disk full")
	h := &stubHealth{}
	r := slotRenamerOver(t, st, f, h)
	if err := r.Enqueue(context.Background(), "standard"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return len(h.keys()) == 1 })
	is := h.keys()["slot_rename_failed:standard"]
	if is.Kind != health.KindSlotRenameFailed || is.Severity != health.Warning {
		t.Fatalf("raised %+v", h.keys())
	}
	waitFor(t, func() bool {
		jobs, _ := r.Active(context.Background())
		return len(jobs) == 0
	})

	f.mu.Lock()
	f.fail = nil
	f.mu.Unlock()
	if err := r.Enqueue(context.Background(), "standard"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return len(h.keys()) == 0 })
}
