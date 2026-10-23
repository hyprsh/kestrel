package imports

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/imports/db"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/store/storetest"
)

// idleLibrary and noProfiles stand in for the modules a plan that is only
// stored, kept and edited reads: nothing is tracked and no Profile exists.
type idleLibrary struct{ AdoptLibrary }

func (idleLibrary) Tracked(context.Context) ([]library.Tracked, error) { return nil, nil }
func (idleLibrary) HeldPaths(context.Context) (map[string]bool, error) { return nil, nil }

type noProfiles struct{}

func (noProfiles) List(context.Context) ([]profiles.Profile, error) { return nil, nil }
func (noProfiles) Region(context.Context) (profiles.Region, bool, error) {
	return profiles.Region{}, false, nil
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

func newPlan(t *testing.T, st *store.Store) *Adoption {
	t.Helper()
	a, err := NewAdoption(AdoptionDeps{Store: st, Library: idleLibrary{}, Profiles: noProfiles{}})
	if err != nil {
		t.Fatal(err)
	}
	return a
}

// seedRow stores a row as a plan keeps it.
func seedRow(t *testing.T, st *store.Store, status RowStatus, ticked bool, r Row) int64 {
	t.Helper()
	data, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	id, err := db.New(st.Write()).InsertAdoptionRow(context.Background(), db.InsertAdoptionRowParams{Status: string(status), Ticked: b2i(ticked), Data: string(data)})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func exec(t *testing.T, st *store.Store, query string, args ...any) {
	t.Helper()
	if _, err := st.Write().Exec(query, args...); err != nil {
		t.Fatal(err)
	}
}

func TestARestartDuringATryAgainKeepsTheRowsAndTheirChoices(t *testing.T) {
	t.Parallel()
	st := openStore(t)
	kept := seedRow(t, st, Matched, true, Row{Entry: "/m/a", Outcome: EndedFailed, Error: "boom", Monitor: library.MonitorNone, Match: &Match{TMDBID: 1}})
	// A Try again keeps the last commit's result and runs as a scan.
	exec(t, st, `UPDATE adoption_plan SET state = 'scanning', adopted = 3, failed = 1, adopted_titles = '[7]' WHERE id = 1`)

	a := newPlan(t, st)

	rows, err := a.rows(context.Background())
	if err != nil || len(rows) != 1 || rows[0].ID != kept || rows[0].Monitor != library.MonitorNone || rows[0].Outcome != EndedFailed {
		t.Fatalf("rows after the restart = %+v, %v; want the kept row as it was", rows, err)
	}
	p, err := a.Get(context.Background())
	if err != nil || p.State != PlanIdle || p.Result == nil || p.Result.Adopted != 3 {
		t.Errorf("plan after the restart = %+v, %v; want idle with the last result", p, err)
	}
}

func TestARestartDuringAScanStillDropsItsRows(t *testing.T) {
	t.Parallel()
	st := openStore(t)
	seedRow(t, st, Matched, true, Row{Entry: "/m/a"})
	exec(t, st, `UPDATE adoption_plan SET state = 'scanning' WHERE id = 1`)

	a := newPlan(t, st)

	if rows, err := a.rows(context.Background()); err != nil || len(rows) != 0 {
		t.Errorf("rows after a restart mid-scan = %+v, %v; want none", rows, err)
	}
}

func TestACommitThatCannotKeepTheRowsLeavesNoRowWithoutAnOutcome(t *testing.T) {
	t.Parallel()
	st := openStore(t)
	for i := range 3 {
		seedRow(t, st, Matched, false, Row{Entry: fmt.Sprintf("/m/%d", i)})
	}
	// Writing the third row's outcome fails, as a full disk would.
	exec(t, st, `CREATE TRIGGER no_third BEFORE UPDATE ON adoption_rows WHEN NEW.id = 3 BEGIN SELECT RAISE(ABORT, 'disk full'); END`)
	exec(t, st, `UPDATE adoption_plan SET state = 'committing' WHERE id = 1`)
	a := newPlan(t, st)
	rows, err := a.rows(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	a.runCommit(context.Background(), rows, nil, CommitResult{})

	left, err := a.rows(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range left {
		if r.Outcome == "" {
			t.Errorf("row %s was left without an outcome among %d rows", r.Entry, len(left))
		}
	}
	if len(left) != 0 && len(left) != 3 {
		t.Errorf("%d of 3 rows kept; want all or none", len(left))
	}
	if p, err := a.Get(context.Background()); err != nil || p.State != PlanIdle {
		t.Errorf("plan = %+v, %v; want idle", p, err)
	}
}

func TestARunThatStartsAsACommitLetsGoOfThePlanKeepsItsOwnCurrentEntry(t *testing.T) {
	t.Parallel()
	st := openStore(t)
	a := newPlan(t, st)
	ctx := context.Background()
	for range 2000 {
		exec(t, st, `UPDATE adoption_plan SET state = 'committing' WHERE id = 1`)
		a.clearCurrent()
		done := make(chan struct{})
		go func() {
			defer close(done)
			a.runCommit(ctx, nil, nil, CommitResult{})
		}()
		// A scan takes the plan the moment the commit lets go of it and names
		// the entry it works on; the commit must not wipe that.
		for started := false; !started; {
			a.mu.Lock()
			p, err := a.q.GetAdoptionPlan(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if PlanState(p.State) != PlanCommitting {
				a.setCurrent("/m/scanned", StepProbing, 1, "")
				started = true
			}
			a.mu.Unlock()
		}
		<-done
		if cur := a.cur.Load(); cur == nil || cur.Entry != "/m/scanned" {
			t.Fatalf("current after the commit = %+v, want the scan's entry", cur)
		}
	}
}

func TestNamingEveryRowOfAFilterOfAHundredThousandRowsTakesNoQuadraticWork(t *testing.T) {
	t.Parallel()
	const n = 100000
	rows := make([]Row, n)
	for i := range rows {
		rows[i] = Row{ID: int64(i + 1), Status: Matched}
		if i%3 == 0 {
			rows[i].Status = Skipped
		}
	}

	start := time.Now()
	got := filterTargets(rows, FilterMatched)

	if want := n - (n+2)/3; len(got) != want {
		t.Fatalf("%d targets, want %d", len(got), want)
	}
	if got[0] != 1 || got[1] != 2 || got[2] != 4 {
		t.Errorf("the first targets are %v, want the Matched rows in the order of the scan", got[:3])
	}
	if took := time.Since(start); took > 5*time.Second {
		t.Errorf("naming the rows of a filter took %s", took)
	}
}
