package jobs_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/library"
)

var now = time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)

type fakeAcquire struct {
	mu       sync.Mutex
	poll     acquire.PollResult
	pollErr  error
	polls    int
	searched [][]int64
	outcome  func(titleID int64, versionIDs []int64) (acquire.Outcome, error)
}

func (f *fakeAcquire) Poll(context.Context) (acquire.PollResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.polls++
	return f.poll, f.pollErr
}

func (f *fakeAcquire) SearchWanted(_ context.Context, titleID int64, versionIDs []int64) (acquire.Outcome, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.searched = append(f.searched, append([]int64{titleID}, versionIDs...))
	return f.outcome(titleID, versionIDs)
}

type fakeLibrary struct {
	due    []library.Due
	marked map[int64]time.Time
}

func (f *fakeLibrary) DueMissing(context.Context, time.Time) ([]library.Due, error) {
	var out []library.Due
	for _, d := range f.due {
		if _, done := f.marked[d.VersionID]; !done {
			out = append(out, d)
		}
	}
	return out, nil
}

func (f *fakeLibrary) MarkMissingSearched(_ context.Context, versionID int64, _, next time.Time) error {
	f.marked[versionID] = next
	return nil
}

func standard(a *fakeAcquire, l *fakeLibrary) *jobs.Runner {
	return jobs.Standard(jobs.Deps{Acquire: a, Library: l, Clock: func() time.Time { return now }})
}

func TestTheDownloadPollRunsEveryTenSecondsWhileAGrabIsActiveAndEveryFiveMinutesOtherwise(t *testing.T) {
	a := &fakeAcquire{poll: acquire.PollResult{Active: true}}
	r := standard(a, &fakeLibrary{})

	if got := r.Every(jobs.Poll); got != 5*time.Minute {
		t.Errorf("before any poll: %v, want 5m", got)
	}
	if err := r.Pass(context.Background(), jobs.Poll); err != nil {
		t.Fatal(err)
	}
	if got := r.Every(jobs.Poll); got != 10*time.Second {
		t.Errorf("with a Grab downloading: %v, want 10s", got)
	}
	a.poll = acquire.PollResult{}
	_ = r.Pass(context.Background(), jobs.Poll)
	if got := r.Every(jobs.Poll); got != 5*time.Minute {
		t.Errorf("with nothing downloading: %v, want 5m", got)
	}
}

func TestStartupReconciliationPollsOnceSoInFlightGrabsAreSeenBeforeTheLoopsRun(t *testing.T) {
	a := &fakeAcquire{}
	r := standard(a, &fakeLibrary{})

	r.Reconcile(context.Background())

	if a.polls != 1 {
		t.Errorf("polls = %d, want 1", a.polls)
	}
}

func TestTheSearchLoopSearchesEachDueTitleOnceMarksItsVersionsAndKicksThePoll(t *testing.T) {
	a := &fakeAcquire{outcome: func(_ int64, v []int64) (acquire.Outcome, error) {
		return acquire.Outcome{Searched: v, Grabbed: []acquire.Grab{{ID: 1}}}, nil
	}}
	l := &fakeLibrary{marked: map[int64]time.Time{}, due: []library.Due{{VersionID: 11, TitleID: 1}, {VersionID: 12, TitleID: 1}, {VersionID: 21, TitleID: 2}}}
	r := standard(a, l)

	if err := r.Pass(context.Background(), jobs.Search); err != nil {
		t.Fatal(err)
	}

	if len(a.searched) != 2 || len(a.searched[0]) != 3 {
		t.Errorf("searched = %v, want title 1 with both its Versions, then title 2", a.searched)
	}
	if len(l.marked) != 3 || l.marked[11].Sub(now) < time.Hour {
		t.Errorf("marked = %v, want every searched Version pushed well past now", l.marked)
	}
	if err := r.Pass(context.Background(), jobs.Search); err != nil || len(a.searched) != 2 {
		t.Errorf("a second pass searched again: %v, %v", a.searched, err)
	}
}

func TestAFailedSearchIsRetriedSoonerThanASuccessfulOne(t *testing.T) {
	a := &fakeAcquire{outcome: func(_ int64, v []int64) (acquire.Outcome, error) {
		return acquire.Outcome{Searched: v}, errors.New("no download client")
	}}
	l := &fakeLibrary{marked: map[int64]time.Time{}, due: []library.Due{{VersionID: 11, TitleID: 1}}}

	if err := standard(a, l).Pass(context.Background(), jobs.Search); err != nil {
		t.Fatal(err)
	}

	if d := l.marked[11].Sub(now); d <= 0 || d > time.Hour {
		t.Errorf("retry in %v, want under an hour", d)
	}
}
