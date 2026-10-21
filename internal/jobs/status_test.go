package jobs_test

import (
	"context"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/library"
)

func TestAfterAPassTheSearchStatusSaysWhatItSearchedAndGrabbedAndWhatIsStillWaiting(t *testing.T) {
	a := &fakeAcquire{outcome: func(title int64, v []int64) (acquire.Outcome, error) {
		if title == 2 {
			return acquire.Outcome{}, nil // the budget stopped the sweep: nothing searched, still due
		}
		return acquire.Outcome{Searched: v, Grabbed: []acquire.Grab{{ID: 1}}}, nil
	}}
	l := &fakeLibrary{marked: map[int64]bool{}, upgraded: map[int64]bool{}, due: []library.Due{
		{VersionID: 11, TitleID: 1}, {VersionID: 12, TitleID: 1}, {VersionID: 21, TitleID: 2, Episodes: 10},
	}}
	r := standard(a, l)
	if got := r.Search(); got.Last != nil || got.Pass != nil {
		t.Fatalf("before any pass = %+v, want no pass running or finished", got)
	}

	if err := r.Pass(context.Background(), jobs.Search); err != nil {
		t.Fatal(err)
	}

	got := r.Search()
	if got.Pass != nil {
		t.Errorf("pass = %+v, want none running", got.Pass)
	}
	if got.Last == nil || !got.Last.FinishedAt.Equal(now) || got.Last.Searched != 2 || got.Last.Grabbed != 1 {
		t.Errorf("last pass = %+v, want it finished now with 2 Versions searched and 1 Grab", got.Last)
	}
	if got.Due != (jobs.SearchDue{Versions: 1, Episodes: 10}) {
		t.Errorf("due = %+v, want the Series Version the budget left waiting, with its 10 episodes", got.Due)
	}
}

func TestBetweenPassesARecountKeepsWhatIsDueCurrent(t *testing.T) {
	a := &fakeAcquire{outcome: func(_ int64, v []int64) (acquire.Outcome, error) { return acquire.Outcome{Searched: v}, nil }}
	l := &fakeLibrary{marked: map[int64]bool{}, upgraded: map[int64]bool{}, due: []library.Due{{VersionID: 11, TitleID: 1}}}
	r := standard(a, l)
	if err := r.Pass(context.Background(), jobs.Search); err != nil {
		t.Fatal(err)
	}
	if got := r.Search().Due; got != (jobs.SearchDue{}) {
		t.Fatalf("due after the pass = %+v, want nothing", got)
	}

	// A Version comes due, and another is due an Upgrade, after the pass.
	l.due = append(l.due, library.Due{VersionID: 21, TitleID: 2, Episodes: 4})
	l.upgrades = []library.Due{{VersionID: 31, TitleID: 3}}
	if err := r.RecountDue(context.Background()); err != nil {
		t.Fatal(err)
	}

	got := r.Search()
	if got.Due != (jobs.SearchDue{Versions: 1, Episodes: 4, Upgrades: 1}) {
		t.Errorf("due after a recount = %+v, want the new Version with its 4 episodes and the Upgrade", got.Due)
	}
	if got.Last == nil || got.Last.Searched != 1 {
		t.Errorf("last pass = %+v, want it kept", got.Last)
	}
}

func TestTheSearchStatusSaysWhenTheNextPassStarts(t *testing.T) {
	a := &fakeAcquire{outcome: func(_ int64, v []int64) (acquire.Outcome, error) { return acquire.Outcome{Searched: v}, nil }}
	r := standard(a, &fakeLibrary{marked: map[int64]bool{}, upgraded: map[int64]bool{}})
	if next := r.Search().Next; !next.IsZero() {
		t.Fatalf("next pass before the loops run = %v, want none", next)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error)
	go func() { done <- r.Run(ctx) }()

	waitFor(t, "the first pass to finish", func() bool { return !r.Search().Next.IsZero() })

	if next := r.Search().Next; !next.Equal(now.Add(5 * time.Minute)) {
		t.Errorf("next pass = %v, want five minutes after the last", next)
	}
	cancel()
	<-done
}

func TestAPassSearchesAFewUpgradesAndTheSearchStatusCountsTheRestAsWaiting(t *testing.T) {
	a := &fakeAcquire{outcome: func(_ int64, v []int64) (acquire.Outcome, error) { return acquire.Outcome{Searched: v}, nil }}
	l := &fakeLibrary{marked: map[int64]bool{}, upgraded: map[int64]bool{}}
	for i := range int64(7) {
		l.upgrades = append(l.upgrades, library.Due{VersionID: 100 + i, TitleID: 10 + i})
	}
	r := standard(a, l)

	if err := r.Pass(context.Background(), jobs.Search); err != nil {
		t.Fatal(err)
	}

	if len(l.upgraded) != 5 {
		t.Errorf("upgraded = %v, want 5 Upgrade searches in one pass", l.upgraded)
	}
	if got := r.Search().Due; got != (jobs.SearchDue{Upgrades: 2}) {
		t.Errorf("due = %+v, want the 2 Upgrade searches left for later passes", got)
	}
}

func TestWhileAPassRunsTheSearchStatusSaysHowFarItHasGot(t *testing.T) {
	var r *jobs.Runner
	var during []jobs.SearchPass
	a := &fakeAcquire{outcome: func(_ int64, v []int64) (acquire.Outcome, error) {
		during = append(during, *r.Search().Pass)
		return acquire.Outcome{}, nil // the budget stopped the sweep: the pass goes through them all the same
	}}
	l := &fakeLibrary{marked: map[int64]bool{}, upgraded: map[int64]bool{}, due: []library.Due{
		{VersionID: 11, TitleID: 1, Fresh: true}, {VersionID: 12, TitleID: 1, Fresh: true}, {VersionID: 21, TitleID: 2}, {VersionID: 31, TitleID: 3},
	}}
	r = standard(a, l)

	if err := r.Pass(context.Background(), jobs.Search); err != nil {
		t.Fatal(err)
	}

	want := []jobs.SearchPass{{StartedAt: now, Total: 4}, {StartedAt: now, Done: 2, Total: 4}, {StartedAt: now, Done: 3, Total: 4}}
	if len(during) != len(want) {
		t.Fatalf("progress seen = %+v, want %+v", during, want)
	}
	for i := range want {
		if during[i] != want[i] {
			t.Errorf("progress seen = %+v, want %+v", during, want)
			break
		}
	}
}
