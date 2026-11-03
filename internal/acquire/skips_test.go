package acquire_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/history"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	"github.com/hyprsh/kestrel/internal/slot"
)

type pausedGrabs bool

func (p pausedGrabs) Paused(context.Context) (bool, error) { return bool(p), nil }

func sweepCtx() context.Context {
	return history.WithTrigger(context.Background(), history.Job(history.TriggerSweep, ""))
}

func TestASweepStoppedByTheBudgetCoalescesToOneEntryPerPassWithTheTitlesNamed(t *testing.T) {
	r := newRig(t)
	hist := r.logged(t)
	r.publish(t, hd1080, time.Hour)
	r.idx.Report(indexer.Limits{Reported: true, APICurrent: 80, APIMax: 100})
	if _, err := r.svc.Search(context.Background(), r.versions[slot.Standard]); err != nil { // the host learns the quota
		t.Fatal(err)
	}
	ctx, skips := acquire.WithSkips(sweepCtx())
	versions := []int64{r.versions[slot.Standard]}

	for range 3 { // three Titles' worth of searches in one pass
		if _, err := r.svc.SearchWanted(ctx, r.titleID, versions); err != nil {
			t.Fatal(err)
		}
	}
	if n := len(eventsOf(t, hist, history.SearchSkipped)); n != 0 {
		t.Fatalf("%d entries before the pass ended", n)
	}
	acquire.FlushSkips(ctx, skips)

	got := eventsOf(t, hist, history.SearchSkipped)
	if len(got) != 1 {
		t.Fatalf("entries = %+v, want one", got)
	}
	e := got[0]
	var data struct {
		Why    string
		Count  int
		Titles []struct{ ID int64 }
	}
	if err := json.Unmarshal(e.Data, &data); err != nil {
		t.Fatal(err)
	}
	if data.Why != "budget" || data.Count != 3 || len(data.Titles) != 1 {
		t.Errorf("data = %+v", data)
	}
	if e.Trigger.Kind != history.TriggerSweep || !strings.HasPrefix(e.Reason, "budget:") || !strings.Contains(e.Message, "3 due searches did not run") || !history.IsRoutine(e.Kind) {
		t.Errorf("entry = %+v", e)
	}
}

func TestADueSearchOutsideAPassWritesItsSkipAtOnce(t *testing.T) {
	r := newRig(t)
	hist := r.logged(t)
	r.publish(t, hd1080, time.Hour)
	r.idx.Report(indexer.Limits{Reported: true, APICurrent: 80, APIMax: 100})
	if _, err := r.svc.Search(context.Background(), r.versions[slot.Standard]); err != nil { // the host learns the quota
		t.Fatal(err)
	}

	if _, err := r.svc.SearchWanted(sweepCtx(), r.titleID, []int64{r.versions[slot.Standard]}); err != nil {
		t.Fatal(err)
	}

	if got := eventsOf(t, hist, history.SearchSkipped); len(got) != 1 {
		t.Fatalf("entries = %+v", got)
	}
}

func TestAnActiveGrabThatCoversAVersionIsLoggedAsSkipped(t *testing.T) {
	r := newRig(t)
	hist := r.logged(t)
	r.publish(t, hd1080, time.Hour)
	versions := []int64{r.versions[slot.Standard]}
	if out, err := r.svc.SearchWanted(sweepCtx(), r.titleID, versions); err != nil || len(out.Grabbed) != 1 {
		t.Fatalf("first search = %+v, %v", out, err)
	}
	r.clock.now = r.clock.now.Add(time.Minute)

	if _, err := r.svc.SearchWanted(sweepCtx(), r.titleID, versions); err != nil {
		t.Fatal(err)
	}

	got := eventsOf(t, hist, history.SearchSkipped)
	if len(got) != 1 || got[0].Reason != "skipped: an active Grab covers it" || got[0].Trigger.Kind != history.TriggerSweep {
		t.Fatalf("entries = %+v", got)
	}
}

func TestPauseGrabsLogsTheSearchThatSentNothing(t *testing.T) {
	r := newRig(t)
	r.deps.Pause = pausedGrabs(true)
	hist := r.logged(t)
	r.publish(t, hd1080, time.Hour)

	out, err := r.svc.SearchWanted(sweepCtx(), r.titleID, []int64{r.versions[slot.Standard]})
	if err != nil || len(out.Grabbed) != 0 {
		t.Fatalf("search = %+v, %v", out, err)
	}

	got := eventsOf(t, hist, history.SearchSkipped)
	if len(got) != 1 || !strings.HasPrefix(got[0].Reason, "Pause Grabs is on") || !strings.Contains(got[0].Message, "sent nothing") {
		t.Fatalf("entries = %+v", got)
	}
}
