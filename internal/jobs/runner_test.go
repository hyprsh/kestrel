package jobs_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/jobs"
)

type trace struct {
	mu  sync.Mutex
	log []string
}

func (t *trace) add(s string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.log = append(t.log, s)
}

func (t *trace) all() []string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return append([]string(nil), t.log...)
}

func waitFor(t *testing.T, what string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(time.Millisecond)
	}
}

func hourly() time.Duration { return time.Hour }

func TestStartupReconciliationFinishesBeforeAnyLoopStarts(t *testing.T) {
	var tr trace
	r := jobs.New(nil)
	r.OnStart("first", func(context.Context) error { tr.add("reconcile-1"); return nil })
	r.OnStart("failing", func(context.Context) error { tr.add("reconcile-2"); return errors.New("boom") })
	r.Add(jobs.Loop{Name: "a", Every: hourly, Run: func(context.Context) error { tr.add("loop"); return nil }})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error)
	go func() { done <- r.Run(ctx) }()

	waitFor(t, "the first loop pass", func() bool { return len(tr.all()) == 3 })
	cancel()
	<-done

	got := tr.all()
	want := []string{"reconcile-1", "reconcile-2", "loop"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("order = %v, want %v (a failing reconciler must not stop the others)", got, want)
		}
	}
}

func TestShutdownWorkRunsOnceEveryLoopHasStopped(t *testing.T) {
	var tr trace
	r := jobs.New(nil)
	r.OnStop(func() { tr.add("stop") })
	r.Add(jobs.Loop{Name: "a", Every: hourly, Run: func(ctx context.Context) error {
		tr.add("loop")
		<-ctx.Done()
		tr.add("loop done")
		return nil
	}})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error)
	go func() { done <- r.Run(ctx) }()

	waitFor(t, "the first loop pass", func() bool { return len(tr.all()) == 1 })
	cancel()
	<-done

	if got := tr.all(); len(got) != 3 || got[2] != "stop" {
		t.Fatalf("order = %v, want the shutdown work last, once", got)
	}
}

func TestKickWakesALoopBeforeItsInterval(t *testing.T) {
	passes := make(chan struct{}, 10)
	r := jobs.New(nil)
	r.Add(jobs.Loop{Name: "sweep", Every: hourly, Run: func(context.Context) error { passes <- struct{}{}; return nil }})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go r.Run(ctx)

	<-passes // the startup pass
	r.Kick("sweep")
	select {
	case <-passes:
	case <-time.After(5 * time.Second):
		t.Fatal("a kick did not run a pass")
	}
}

func TestALoopRunsAgainAfterItsIntervalAndTheIntervalIsReadEveryTime(t *testing.T) {
	passes := make(chan struct{}, 100)
	var mu sync.Mutex
	every := time.Hour
	r := jobs.New(nil)
	r.Add(jobs.Loop{Name: "poll", Every: func() time.Duration { mu.Lock(); defer mu.Unlock(); return every }, Run: func(context.Context) error { passes <- struct{}{}; return nil }})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go r.Run(ctx)
	<-passes

	mu.Lock()
	every = time.Millisecond
	mu.Unlock()
	r.Kick("poll") // the pass after this one is scheduled with the new interval
	<-passes
	<-passes
	<-passes
}

func TestPassesOfOneLoopNeverOverlapAndRunningListsWhatIsInFlight(t *testing.T) {
	enter, release := make(chan struct{}), make(chan struct{})
	r := jobs.New(nil)
	r.Add(jobs.Loop{Name: "slow", Every: hourly, Run: func(context.Context) error { enter <- struct{}{}; <-release; return nil }})
	done := make(chan error, 2)
	go func() { done <- r.Pass(context.Background(), "slow") }()
	<-enter
	if got := r.Running(); len(got) != 1 || got[0] != "slow" {
		t.Errorf("Running = %v, want [slow]", got)
	}
	go func() { done <- r.Pass(context.Background(), "slow") }()
	select {
	case <-enter:
		t.Fatal("a second pass of the same loop started while one was running")
	case <-time.After(20 * time.Millisecond):
	}
	close(release)
	<-done
	<-enter
	<-done
	if got := r.Running(); len(got) != 0 {
		t.Errorf("Running = %v, want none", got)
	}
}

func TestPassOfAnUnknownLoopIsAnError(t *testing.T) {
	if err := jobs.New(nil).Pass(context.Background(), "nope"); err == nil {
		t.Error("want an error")
	}
}
