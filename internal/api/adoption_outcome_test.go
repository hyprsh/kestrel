package api_test

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/app"
	"github.com/hyprsh/kestrel/internal/probe"
)

func (a adopting) outcomes(t *testing.T, outcome string) []adoptionRowJSON {
	t.Helper()
	return decode[struct {
		Items []adoptionRowJSON `json:"items"`
	}](t, a.valid("GET", "/adoption/rows?outcome="+outcome, "")).Items
}

// finishedPlan scans a plan with one row of every outcome and returns the
// revision to commit and the file of Paddington, which is removed so that
// row fails: Breaking Bad is adopted, The Lost Film is unticked, Broken is
// skipped and Unknown is never chosen.
func (a adopting) finishedPlan(t *testing.T) (revision int64, pad string) {
	t.Helper()
	pad = a.put(t, "Paddington.2014.1080p.BluRay.x264-GRP/Paddington.2014.1080p.BluRay.x264-GRP.mkv", "pad")
	a.putTV(t, bbFolder+"/Season 01/Breaking.Bad.S01E01.1080p.WEB-DL.x264-GRP.mkv", "bb")
	a.put(t, "The Lost Film (2020) [tmdbid-77]/lost.film.mkv", "lost")
	a.put(t, "Broken Thing (2001)/broken.mkv", "x")
	a.put(t, "Unknown Thing/thing.mkv", "nobody knows")
	a.scan(t)
	left := a.rowOf(t, "The Lost Film (2020) [tmdbid-77]")
	if left.Status != "matched" {
		t.Fatalf("The Lost Film row = %+v", left)
	}
	a.valid("PATCH", fmt.Sprintf("/adoption/rows/%d", left.ID), `{"ticked":false}`)
	if err := os.Remove(pad); err != nil {
		t.Fatal(err)
	}
	return decode[adoptionJSON](t, a.valid("GET", "/adoption", "")).Revision, pad
}

func TestACommitKeepsTheRowsEachWithItsFinalOutcome(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	rev, _ := a.finishedPlan(t)

	done := a.commit(t, rev)

	if done.State != "idle" || done.Result == nil {
		t.Fatalf("plan = %+v", done)
	}
	if o := done.Result.Outcomes; o.Adopted != 1 || o.Failed != 1 || o.Skipped != 1 || o.NotChosen != 1 || o.Unticked != 1 {
		t.Errorf("outcomes = %+v, want one of each", o)
	}
	for outcome, entry := range map[string]string{
		"adopted": bbFolder, "failed": "Paddington.2014.1080p.BluRay.x264-GRP",
		"unticked": "The Lost Film (2020) [tmdbid-77]", "skipped": "Broken Thing (2001)", "not_chosen": "Unknown Thing",
	} {
		rows := a.outcomes(t, outcome)
		if len(rows) != 1 || !strings.HasSuffix(rows[0].Entry, entry) || rows[0].Outcome == nil || *rows[0].Outcome != outcome {
			t.Errorf("outcome=%s rows = %+v, want %s", outcome, rows, entry)
		}
	}
	if failed := a.outcomes(t, "failed")[0]; failed.Error == nil || *failed.Error == "" {
		t.Errorf("the failed row names no error: %+v", failed)
	}
	if all := a.kept(t); len(all) != 5 {
		t.Errorf("rows after the commit = %d, want all 5 kept", len(all))
	}
}

func TestScanningAgainDropsTheRowsAFinishedCommitKept(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	rev, _ := a.finishedPlan(t)
	a.commit(t, rev)

	a.scan(t)

	if got := a.outcomes(t, "adopted"); len(got) != 0 {
		t.Errorf("adopted rows after a new scan = %+v", got)
	}
	for _, r := range a.rows(t, "") {
		if r.Outcome != nil {
			t.Errorf("row %s still has outcome %q after a new scan", r.Entry, *r.Outcome)
		}
	}
}

func TestTryAgainPlansOnlyTheFailedEntriesWithoutScanningAgain(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	rev, pad := a.finishedPlan(t)
	a.commit(t, rev)
	if err := os.WriteFile(pad, []byte("pad again"), 0o644); err != nil {
		t.Fatal(err)
	}
	a.put(t, "Paddington/pad.mkv", "never scanned") // a retry must not see a folder that is new since the scan

	if r := a.valid("POST", "/adoption/retry", ""); r.Status != 202 {
		t.Fatalf("retry = %d %s", r.Status, r.Body)
	}
	plan := a.settled(t, "scanning")

	if plan.State != "planned" || plan.Summary.Matched != 1 || plan.Summary.NeedsChoice != 0 || plan.Summary.Skipped != 0 {
		t.Fatalf("plan after retry = %+v", plan)
	}
	rows := a.rows(t, "")
	if len(rows) != 1 || filepath.Base(rows[0].Entry) != "Paddington.2014.1080p.BluRay.x264-GRP" || !rows[0].Ticked || rows[0].Outcome != nil {
		t.Fatalf("rows after retry = %+v", rows)
	}
	done := a.commit(t, plan.Revision)
	if done.Result == nil || done.Result.Adopted != 2 || done.Result.Failed != 0 {
		t.Errorf("after the second commit = %+v", done)
	}
}

func TestTryAgainWithNothingFailedIsAConflict(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	a.put(t, "Paddington.2014.1080p.BluRay.x264-GRP/Paddington.2014.1080p.BluRay.x264-GRP.mkv", "pad")
	a.commit(t, a.scan(t).Revision)

	if r := a.valid("POST", "/adoption/retry", ""); r.Status != 409 {
		t.Errorf("retry with nothing failed = %d %s, want 409", r.Status, r.Body)
	}
}

// gatedProber holds every probe until released, saying which file it holds.
type gatedProber struct {
	inner   pathProber
	reached chan string
	release chan struct{}
}

func (g *gatedProber) Probe(ctx context.Context, path string) (probe.Info, error) {
	g.reached <- path
	<-g.release
	return g.inner.Probe(ctx, path)
}

func TestTheProgressNamesTheEntryBeingScannedAndWhatIsHappeningToIt(t *testing.T) {
	t.Parallel()
	g := &gatedProber{reached: make(chan string, 8), release: make(chan struct{})}
	a := newAdopting(t, func(o *app.Options) { o.Prober = g })
	a.put(t, "Paddington (2014)/pad.mkv", "pad")
	a.put(t, "Paddington (2014)/pad.uhd.mkv", "pad2")
	if r := a.valid("POST", "/adoption/scan", ""); r.Status != 202 {
		t.Fatalf("scan = %d %s", r.Status, r.Body)
	}
	<-g.reached

	type current struct {
		Entry string `json:"entry"`
		Step  string `json:"step"`
		Files *int   `json:"files"`
	}
	read := func() *current {
		return decode[struct {
			Progress struct {
				Current *current `json:"current"`
			} `json:"progress"`
		}](t, a.valid("GET", "/adoption", "")).Progress.Current
	}
	cur := read()
	if cur == nil || !strings.HasSuffix(cur.Entry, "Paddington (2014)") || cur.Step != "probing" || cur.Files == nil || *cur.Files != 2 {
		t.Errorf("progress.current while probing = %+v", cur)
	}
	act := decode[struct {
		Adoption *struct {
			Current *current `json:"current"`
		} `json:"adoption"`
	}](t, a.valid("GET", "/activity", ""))
	if act.Adoption == nil || act.Adoption.Current == nil || act.Adoption.Current.Step != "probing" {
		t.Errorf("activity.adoption.current = %+v", act.Adoption)
	}
	close(g.release)
	a.settled(t, "scanning")
	if cur := read(); cur != nil {
		t.Errorf("progress.current after the scan = %+v, want none", cur)
	}
}
