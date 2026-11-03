package indexers_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/indexers"
	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
)

func indexerEvents(t *testing.T, h *history.Service) []history.Event {
	t.Helper()
	all, err := h.After(context.Background(), 0, 1000)
	if err != nil {
		t.Fatal(err)
	}
	return all
}

func TestAPauseIsOneEntryNotOnePerRequestAndItsEndIsOneRecovery(t *testing.T) {
	b := newBudgetRig(t, nil)
	h := history.New(b.r.st, b.clk.now, nil)
	b.r.svc.SetHistory(h)
	ctx := history.WithTrigger(context.Background(), history.Person("navi", "Search now"))
	b.search(ctx)
	b.f.Exhaust(plugin.LimitSearch, 20*time.Minute)
	b.search(ctx)
	b.f.Replenish()
	for range 5 {
		b.search(ctx) // refused during the pause: nothing new to say
	}
	evs := indexerEvents(t, h)
	if len(evs) != 1 || evs[0].Kind != history.IndexerPaused {
		t.Fatalf("events = %+v, want one indexer_paused", evs)
	}
	if e := evs[0]; e.Trigger.Kind != history.TriggerPerson || e.Trigger.Actor != "navi" || !strings.Contains(e.Reason, "limit:") || !strings.Contains(e.Reason, "10:20 UTC") {
		t.Errorf("entry = %+v", e)
	}
	b.clk.advance(21 * time.Minute)
	b.search(history.WithTrigger(context.Background(), history.Job(history.TriggerRSS, "")))
	evs = indexerEvents(t, h)
	if len(evs) != 2 || evs[1].Kind != history.IndexerRecovered || evs[1].Trigger.Kind != history.TriggerRSS || !strings.Contains(evs[1].Reason, "pause ended") {
		t.Fatalf("after the pause: %+v", evs)
	}
}

func TestTheSweepStopAt80PercentIsOneEntryWithTheSweepsTriggerAndTheNextDayRecovers(t *testing.T) {
	b := newBudgetRig(t, map[string]any{"api_requests_per_day": float64(10)})
	h := history.New(b.r.st, b.clk.now, nil)
	b.r.svc.SetHistory(h)
	sweep := indexers.WithSweep(history.WithTrigger(context.Background(), history.Job(history.TriggerSweep, "")))
	for range 12 {
		b.search(sweep)
	}
	evs := indexerEvents(t, h)
	if len(evs) != 1 || evs[0].Kind != history.IndexerSweepStopped || evs[0].Trigger.Kind != history.TriggerSweep || !strings.Contains(evs[0].Reason, "8 of 10") {
		t.Fatalf("events = %+v", evs)
	}
	b.clk.advance(24 * time.Hour)
	b.r.svc.CanSweep(sweep)
	evs = indexerEvents(t, h)
	if len(evs) != 2 || evs[1].Kind != history.IndexerRecovered || evs[1].Trigger.Kind != history.TriggerSweep {
		t.Fatalf("events = %+v", evs)
	}
}

func TestBackingOffIsOneEntryAndAChangedConnectionRecovers(t *testing.T) {
	b := newBudgetRig(t, nil)
	h := history.New(b.r.st, b.clk.now, nil)
	b.r.svc.SetHistory(h)
	ctx := history.WithTrigger(context.Background(), history.Job(history.TriggerRSS, ""))
	if _, err := b.r.inst.Update(ctx, b.id, instances.Patch{Config: map[string]any{"api_key": "wrong"}}); err != nil {
		t.Fatal(err)
	}
	b.search(ctx) // the first failure retries at once: no back-off yet
	if n := len(indexerEvents(t, h)); n != 0 {
		t.Fatalf("%d entries after one failure", n)
	}
	b.search(ctx)
	b.search(ctx)
	evs := indexerEvents(t, h)
	if len(evs) != 1 || evs[0].Kind != history.IndexerBackedOff || !strings.Contains(evs[0].Reason, "failure 2 in a row") {
		t.Fatalf("events = %+v", evs)
	}
	if _, err := b.r.inst.Update(ctx, b.id, instances.Patch{Config: map[string]any{"api_key": "k"}}); err != nil {
		t.Fatal(err)
	}
	b.search(ctx)
	evs = indexerEvents(t, h)
	if len(evs) != 2 || evs[1].Kind != history.IndexerRecovered || !strings.Contains(evs[1].Reason, "settings were changed") {
		t.Fatalf("events = %+v", evs)
	}
}

func TestSlowAnswersWidenTheGapOnceAndQuickOnesRecover(t *testing.T) {
	p := newPacingRig(t, 2)
	h := history.New(p.st, p.clk.now, nil)
	p.svc.SetHistory(h)
	ctx := history.WithTrigger(context.Background(), history.Job(history.TriggerSweep, ""))
	for range 3 {
		p.search(ctx)
	}
	p.l.setTook(20 * time.Second)
	p.search(ctx)
	p.search(ctx) // doubles again: still the one entry
	evs := indexerEvents(t, h)
	if len(evs) != 1 || evs[0].Kind != history.IndexerSlow || evs[0].Trigger.Kind != history.TriggerSweep {
		t.Fatalf("events = %+v", evs)
	}
	p.l.setTook(time.Second)
	for range 8 {
		p.search(ctx)
	}
	evs = indexerEvents(t, h)
	if len(evs) != 2 || evs[1].Kind != history.IndexerRecovered {
		t.Fatalf("events = %+v", evs)
	}
}
