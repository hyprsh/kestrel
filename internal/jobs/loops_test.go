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
	mu      sync.Mutex
	poll    acquire.PollResult
	pollErr error
	polls   int
	// reconciles counts the startup polls.
	reconciles int
	searched   [][]int64
	upgraded   [][]int64

	rss       acquire.RSSOutcome
	rssErr    error
	rssPasses int

	outcome func(titleID int64, versionIDs []int64) (acquire.Outcome, error)
}

func (f *fakeAcquire) Poll(context.Context) (acquire.PollResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.polls++
	return f.poll, f.pollErr
}

func (f *fakeAcquire) Reconcile(context.Context) (acquire.PollResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.reconciles++
	return f.poll, f.pollErr
}

func (f *fakeAcquire) SyncRSS(context.Context) (acquire.RSSOutcome, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.rssPasses++
	return f.rss, f.rssErr
}

func (f *fakeAcquire) SearchWanted(_ context.Context, titleID int64, versionIDs []int64) (acquire.Outcome, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.searched = append(f.searched, append([]int64{titleID}, versionIDs...))
	return f.outcome(titleID, versionIDs)
}

func (f *fakeAcquire) SearchNew(ctx context.Context, titleID int64, versionIDs []int64) (acquire.Outcome, error) {
	return f.SearchWanted(ctx, titleID, versionIDs)
}

func (f *fakeAcquire) SearchUpgrades(_ context.Context, titleID int64, versionIDs []int64) (acquire.Outcome, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.upgraded = append(f.upgraded, append([]int64{titleID}, versionIDs...))
	return acquire.Outcome{Searched: versionIDs}, nil
}

// fakeLibrary has the Versions in due waiting for a missing search; marked
// records the Versions searched and whether the search failed.
type fakeLibrary struct {
	due       []library.Due
	marked    map[int64]bool
	upgrades  []library.Due
	upgraded  map[int64]bool
	lastLimit int
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

func (f *fakeLibrary) MarkMissingSearched(_ context.Context, versionID int64, _ time.Time, failed bool) error {
	f.marked[versionID] = failed
	return nil
}

func (f *fakeLibrary) DueUpgrades(_ context.Context, _ time.Time, limit int) ([]library.Due, error) {
	f.lastLimit = limit
	var out []library.Due
	for _, d := range f.upgrades {
		if _, done := f.upgraded[d.VersionID]; !done {
			out = append(out, d)
		}
	}
	return out, nil
}

func (f *fakeLibrary) MarkUpgradeSearched(_ context.Context, versionID int64, _ time.Time, failed bool) error {
	f.upgraded[versionID] = failed
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

	if a.reconciles != 1 || a.polls != 0 {
		t.Errorf("reconciles = %d, polls = %d, want one startup poll", a.reconciles, a.polls)
	}
}

func TestTheSearchLoopSearchesEachDueTitleOnceMarksItsVersionsAndKicksThePoll(t *testing.T) {
	a := &fakeAcquire{outcome: func(_ int64, v []int64) (acquire.Outcome, error) {
		return acquire.Outcome{Searched: v, Grabbed: []acquire.Grab{{ID: 1}}}, nil
	}}
	l := &fakeLibrary{marked: map[int64]bool{}, due: []library.Due{{VersionID: 11, TitleID: 1}, {VersionID: 12, TitleID: 1}, {VersionID: 21, TitleID: 2}}}
	r := standard(a, l)

	if err := r.Pass(context.Background(), jobs.Search); err != nil {
		t.Fatal(err)
	}

	if len(a.searched) != 2 || len(a.searched[0]) != 3 {
		t.Errorf("searched = %v, want title 1 with both its Versions, then title 2", a.searched)
	}
	if len(l.marked) != 3 || l.marked[11] {
		t.Errorf("marked = %v, want every searched Version marked as searched without failure", l.marked)
	}
	if err := r.Pass(context.Background(), jobs.Search); err != nil || len(a.searched) != 2 {
		t.Errorf("a second pass searched again: %v, %v", a.searched, err)
	}
}

func TestTheRSSLoopRunsEveryFifteenMinutes(t *testing.T) {
	a := &fakeAcquire{rss: acquire.RSSOutcome{Grabbed: []acquire.Grab{{ID: 1}}}}
	r := standard(a, &fakeLibrary{})

	if got := r.Every(jobs.RSS); got != 15*time.Minute {
		t.Errorf("RSS cadence = %v, want 15m", got)
	}
	if err := r.Pass(context.Background(), jobs.RSS); err != nil {
		t.Fatal(err)
	}
	if a.rssPasses != 1 {
		t.Errorf("rss passes = %d, want 1", a.rssPasses)
	}
}

func TestAFailingRSSPassIsReportedSoTheRunnerCanLogIt(t *testing.T) {
	a := &fakeAcquire{rssErr: errors.New("no download client")}
	if err := standard(a, &fakeLibrary{}).Pass(context.Background(), jobs.RSS); err == nil {
		t.Error("want the error")
	}
}

type fakeHealth struct{ runs int }

func (f *fakeHealth) RunChecks(context.Context) error { f.runs++; return nil }

func TestTheHealthLoopRunsTheChecksEveryFiveMinutes(t *testing.T) {
	h := &fakeHealth{}
	r := jobs.Standard(jobs.Deps{Acquire: &fakeAcquire{}, Library: &fakeLibrary{}, Health: h, Clock: func() time.Time { return now }})

	if got := r.Every(jobs.Health); got != 5*time.Minute {
		t.Errorf("health cadence = %v, want 5m", got)
	}
	if err := r.Pass(context.Background(), jobs.Health); err != nil {
		t.Fatal(err)
	}
	if h.runs != 1 {
		t.Errorf("check runs = %d, want 1", h.runs)
	}
}

func TestWithoutHealthThereIsNoHealthLoop(t *testing.T) {
	r := standard(&fakeAcquire{}, &fakeLibrary{})
	if err := r.Pass(context.Background(), jobs.Health); err == nil {
		t.Error("want an unknown loop error")
	}
}

func TestAFailedSearchIsRetriedSoonerThanASuccessfulOne(t *testing.T) {
	a := &fakeAcquire{outcome: func(_ int64, v []int64) (acquire.Outcome, error) {
		return acquire.Outcome{Searched: v}, errors.New("no download client")
	}}
	l := &fakeLibrary{marked: map[int64]bool{}, due: []library.Due{{VersionID: 11, TitleID: 1}}}

	if err := standard(a, l).Pass(context.Background(), jobs.Search); err != nil {
		t.Fatal(err)
	}

	if failed, ok := l.marked[11]; !ok || !failed {
		t.Errorf("marked = %v, want the Version marked as failed so the library retries it soon", l.marked)
	}
}

func TestTheSweepSearchesUpgradesAfterTheMissingSearchesAndAtMostAFewPerPass(t *testing.T) {
	a := &fakeAcquire{outcome: func(_ int64, v []int64) (acquire.Outcome, error) { return acquire.Outcome{Searched: v}, nil }}
	l := &fakeLibrary{
		marked: map[int64]bool{}, upgraded: map[int64]bool{},
		due:      []library.Due{{VersionID: 11, TitleID: 1}},
		upgrades: []library.Due{{VersionID: 22, TitleID: 2}, {VersionID: 23, TitleID: 2}, {VersionID: 31, TitleID: 3}},
	}

	if err := standard(a, l).Pass(context.Background(), jobs.Search); err != nil {
		t.Fatal(err)
	}

	if len(a.searched) != 1 || a.searched[0][0] != 1 {
		t.Errorf("missing searches = %v, want title 1", a.searched)
	}
	if len(a.upgraded) != 2 || len(a.upgraded[0]) != 3 || a.upgraded[1][0] != 3 {
		t.Errorf("upgrade searches = %v, want title 2 with both its Versions, then title 3", a.upgraded)
	}
	if l.lastLimit <= 0 {
		t.Errorf("the Upgrade sweep asked for %d Versions, want a small limit so one pass cannot search a whole library", l.lastLimit)
	}
	if len(l.upgraded) != 3 {
		t.Errorf("upgraded = %v, want each searched Version marked", l.upgraded)
	}
}
