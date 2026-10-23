package api_test

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/hyprsh/kestrel/internal/app"
	"github.com/hyprsh/kestrel/internal/probe"
)

// switchProber is the path prober until broken, then ffprobe is missing.
type switchProber struct{ broken atomic.Bool }

func (p *switchProber) Probe(ctx context.Context, path string) (probe.Info, error) {
	if p.broken.Load() {
		return probe.Info{}, probe.ErrNotInstalled
	}
	return pathProber{}.Probe(ctx, path)
}

func (a adopting) retry(t *testing.T) adoptionJSON {
	t.Helper()
	if r := a.valid("POST", "/adoption/retry", ""); r.Status != 202 {
		t.Fatalf("retry = %d %s", r.Status, r.Body)
	}
	return a.settled(t, "scanning")
}

func (a adopting) reopen(t *testing.T) adoptionJSON {
	t.Helper()
	r := a.valid("POST", "/adoption/reopen", "")
	if r.Status != 200 {
		t.Fatalf("reopen = %d %s", r.Status, r.Body)
	}
	return decode[adoptionJSON](t, r)
}

// kept is every row a commit kept, whatever its outcome.
func (a adopting) kept(t *testing.T) []adoptionRowJSON {
	t.Helper()
	var all []adoptionRowJSON
	for _, outcome := range []string{"adopted", "failed", "skipped", "not_chosen", "unticked"} {
		all = append(all, a.outcomes(t, outcome)...)
	}
	return all
}

func (a adopting) logged(t *testing.T) []eventJSON {
	t.Helper()
	return decode[eventsJSON](t, a.valid("GET", "/events?routine=true&kind=adoption_scanned", "")).Items
}

func TestTryAgainKeepsTheOtherRowsAndTheSecondCommitAddsToTheFirstResult(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	rev, pad := a.finishedPlan(t)
	first := a.commit(t, rev)
	if err := os.WriteFile(pad, []byte("pad again"), 0o644); err != nil {
		t.Fatal(err)
	}

	plan := a.retry(t)

	if plan.State != "planned" || plan.Result == nil || plan.Result.Adopted != 1 || len(plan.Result.TitleIDs) != 1 {
		t.Fatalf("plan after Try again = %+v, want the first result kept", plan)
	}
	for outcome, want := range map[string]int{"adopted": 1, "skipped": 1, "not_chosen": 1, "unticked": 1, "failed": 0} {
		if got := a.outcomes(t, outcome); len(got) != want {
			t.Errorf("outcome=%s rows after Try again = %d, want %d", outcome, len(got), want)
		}
	}
	if rows := a.rows(t, ""); len(rows) != 1 || rows[0].Outcome != nil {
		t.Errorf("rows under review = %+v, want the one failed entry planned again", rows)
	}

	done := a.commit(t, plan.Revision)

	if done.Result == nil || done.Result.Adopted != 2 || done.Result.Failed != 0 || done.Result.Outcomes.Adopted != 2 || len(done.Result.TitleIDs) != 2 {
		t.Errorf("result after the second commit = %+v, want it added to the first (%+v)", done.Result, first.Result)
	}
	if got := a.outcomes(t, "adopted"); len(got) != 2 {
		t.Errorf("adopted rows after the second commit = %d, want 2", len(got))
	}
}

func TestTryAgainThatCannotPlanStillShowsTheSummaryOfTheLastCommit(t *testing.T) {
	t.Parallel()
	pr := &switchProber{}
	a := newAdopting(t, func(o *app.Options) { o.Prober = pr })
	rev, pad := a.finishedPlan(t)
	a.commit(t, rev)
	if err := os.WriteFile(pad, []byte("pad again"), 0o644); err != nil {
		t.Fatal(err)
	}
	pr.broken.Store(true)

	plan := a.retry(t)

	if plan.State != "idle" || plan.Error == nil || plan.Result == nil || plan.Result.Adopted != 1 {
		t.Fatalf("plan after a Try again that failed = %+v, want idle with the error and the last result", plan)
	}
	for outcome, want := range map[string]int{"adopted": 1, "failed": 1, "skipped": 1, "not_chosen": 1, "unticked": 1} {
		if got := a.outcomes(t, outcome); len(got) != want {
			t.Errorf("outcome=%s rows = %d, want %d", outcome, len(got), want)
		}
	}
}

func TestReopeningTheNotChosenRowsPutsThemBackInThePlanToSettle(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	rev, _ := a.finishedPlan(t)
	a.commit(t, rev)
	unknown := a.outcomes(t, "not_chosen")[0]

	plan := a.reopen(t)

	if plan.State != "planned" || plan.Summary.NeedsChoice != 1 || plan.Summary.Matched != 0 || plan.Result == nil || plan.Result.Adopted != 1 {
		t.Fatalf("plan after reopening = %+v", plan)
	}
	rows := a.rows(t, "")
	if len(rows) != 1 || rows[0].ID != unknown.ID || rows[0].Status != "needs_choice" || rows[0].Outcome != nil {
		t.Fatalf("rows under review = %+v, want the not chosen row as Needs choice", rows)
	}
	if got := a.outcomes(t, "not_chosen"); len(got) != 0 {
		t.Errorf("not chosen rows after reopening = %d, want none", len(got))
	}
	for outcome, want := range map[string]int{"adopted": 1, "failed": 1, "skipped": 1, "unticked": 1} {
		if got := a.outcomes(t, outcome); len(got) != want {
			t.Errorf("outcome=%s rows after reopening = %d, want the others kept (%d)", outcome, len(got), want)
		}
	}

	if r := a.valid("PATCH", fmt.Sprintf("/adoption/rows/%d", unknown.ID), `{"tmdb_id":116149}`); r.Status != 200 {
		t.Fatalf("settling = %d %s", r.Status, r.Body)
	}
	done := a.commit(t, a.plan(t).Revision)

	if done.Result == nil || done.Result.Adopted != 2 || done.Result.Outcomes.NotChosen != 0 || done.Result.Outcomes.Failed != 1 {
		t.Errorf("result after committing the settled row = %+v", done.Result)
	}
}

func TestReopeningWithNothingNotChosenIsAConflict(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	a.put(t, "Paddington.2014.1080p.BluRay.x264-GRP/Paddington.2014.1080p.BluRay.x264-GRP.mkv", "pad")
	a.commit(t, a.scan(t).Revision)

	if r := a.valid("POST", "/adoption/reopen", ""); r.Status != 409 {
		t.Errorf("reopen with nothing not chosen = %d %s, want 409", r.Status, r.Body)
	}
}

func TestTryAgainAndReopeningEachRecordAnEventInTheLog(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	rev, pad := a.finishedPlan(t)
	a.commit(t, rev)
	if got := len(a.logged(t)); got != 1 {
		t.Fatalf("events after the scan = %d, want 1", got)
	}
	if err := os.WriteFile(pad, []byte("pad again"), 0o644); err != nil {
		t.Fatal(err)
	}
	a.retry(t)
	a.commit(t, a.plan(t).Revision)

	got := a.logged(t)

	if len(got) != 2 || !strings.Contains(strings.ToLower(got[0].Message), "try again") {
		t.Fatalf("events after Try again = %+v, want one that says so", got)
	}
	a.reopen(t)
	if got := a.logged(t); len(got) != 3 || !strings.Contains(strings.ToLower(got[0].Message), "reopen") {
		t.Errorf("events after reopening = %+v, want one that says so", got)
	}
}
