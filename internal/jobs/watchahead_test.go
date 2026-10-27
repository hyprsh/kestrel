package jobs_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/jobs"
)

type fakeWatchAhead struct {
	passes int
	added  int
	err    error
}

func (f *fakeWatchAhead) Pass(context.Context) (int, error) { f.passes++; return f.added, f.err }

func TestTheWatchAheadLoopPassesEveryFifteenMinutes(t *testing.T) {
	w := &fakeWatchAhead{}
	r := jobs.Standard(jobs.Deps{Acquire: &fakeAcquire{}, Library: &fakeLibrary{}, WatchAhead: w, Clock: func() time.Time { return now }})
	if got := r.Every(jobs.WatchAhead); got != 15*time.Minute {
		t.Errorf("cadence = %v, want 15m", got)
	}
	if err := r.Pass(context.Background(), jobs.WatchAhead); err != nil || w.passes != 1 {
		t.Errorf("passes = %d, err %v, want one pass", w.passes, err)
	}
}

func TestAWatchAheadPassThatFailsReportsIt(t *testing.T) {
	w := &fakeWatchAhead{err: errors.New("Plex is down")}
	r := jobs.Standard(jobs.Deps{Acquire: &fakeAcquire{}, Library: &fakeLibrary{}, WatchAhead: w, Clock: func() time.Time { return now }})
	if err := r.Pass(context.Background(), jobs.WatchAhead); err == nil {
		t.Error("the failure was hidden")
	}
}

func TestWithoutWatchAheadThereIsNoWatchAheadLoop(t *testing.T) {
	r := standard(&fakeAcquire{}, &fakeLibrary{})
	if err := r.Pass(context.Background(), jobs.WatchAhead); err == nil {
		t.Error("want an unknown loop error")
	}
}
