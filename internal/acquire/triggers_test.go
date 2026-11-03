package acquire_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/slot"
)

// byPerson is the context of a call a signed-in person makes; the API gives every call one.
func byPerson() context.Context {
	return history.WithTrigger(context.Background(), history.Person("navi", "TestCall"))
}

// logged rebuilds the Service with a Log and returns it.
func (r *rig) logged(t *testing.T) *history.Service {
	t.Helper()
	hist := history.New(r.deps.Store, r.clock.Now, nil)
	r.deps.History = hist
	svc, err := acquire.New(r.deps)
	if err != nil {
		t.Fatal(err)
	}
	r.svc = svc
	return hist
}

// eventsOf are the Log's events of a kind, oldest first.
func eventsOf(t *testing.T, h *history.Service, k history.Kind) []history.Event {
	t.Helper()
	all, err := h.After(context.Background(), 0, 1000)
	if err != nil {
		t.Fatal(err)
	}
	var out []history.Event
	for _, e := range all {
		if e.Kind == k {
			out = append(out, e)
		}
	}
	return out
}

func TestARejectedImportsRetryLeavesASearchedEntryWithTriggerRetry(t *testing.T) {
	ctx := history.WithTrigger(context.Background(), history.Job(history.TriggerImport, ""))
	r := newRig(t)
	hist := r.logged(t)
	first := r.twoCandidates(t)
	_ = r.sab.Complete(first.ClientID, "/data/usenet/movies/Paddington")
	_, _ = r.svc.Poll(ctx)
	if _, err := r.svc.DueImports(ctx); err != nil {
		t.Fatal(err)
	}
	before := len(eventsOf(t, hist, history.Searched))

	if err := r.svc.RecordImport(ctx, first.ID, true, acquire.ImportOutcome{Status: acquire.ImportRejected, Reason: "language"}); err != nil {
		t.Fatal(err)
	}

	searched := eventsOf(t, hist, history.Searched)
	if len(searched) != before+1 {
		t.Fatalf("%d Searched entries, want %d: one for the retry", len(searched), before+1)
	}
	got := searched[len(searched)-1]
	if got.Trigger.Kind != history.TriggerRetry {
		t.Errorf("trigger = %+v, want retry", got.Trigger)
	}
	if !strings.Contains(got.Reason, "retry") || !strings.Contains(got.Reason, first.ReleaseName) || !strings.Contains(got.Reason, "language") {
		t.Errorf("reason = %q, want it to name the Release and the rejection", got.Reason)
	}
	grabs := eventsOf(t, hist, history.GrabSent)
	last := grabs[len(grabs)-1]
	if last.Trigger.Kind != history.TriggerRetry || !strings.Contains(last.Reason, "language") {
		t.Errorf("the retry's Grab = %+v, want trigger retry and the rejection in its reason", last)
	}
}

func TestCancelWithBlocklistKeepsTheGrabIdTheReleaseAndTheActor(t *testing.T) {
	ctx := byPerson()
	r := newRig(t)
	hist := r.logged(t)
	first := r.twoCandidates(t)

	if _, err := r.svc.Cancel(ctx, first.ID, true); err != nil {
		t.Fatal(err)
	}

	canceled := eventsOf(t, hist, history.GrabCanceled)
	if len(canceled) != 1 {
		t.Fatalf("%d grab_canceled entries, want 1", len(canceled))
	}
	c := canceled[0]
	if c.Trigger.Kind != history.TriggerPerson || c.Trigger.Actor != "navi" {
		t.Errorf("trigger = %+v, want the person", c.Trigger)
	}
	var data struct {
		GrabID      int64  `json:"grab_id"`
		Release     string `json:"release"`
		TitleID     int64  `json:"title_id"`
		VersionID   int64  `json:"version_id"`
		Blocklisted bool   `json:"blocklisted"`
	}
	if err := json.Unmarshal(c.Data, &data); err != nil {
		t.Fatal(err)
	}
	if data.GrabID != first.ID || data.Release != first.ReleaseName || data.TitleID != r.titleID || data.VersionID != first.VersionID || !data.Blocklisted {
		t.Errorf("data = %+v, want Grab %d, Release %q, the Title and Version, blocklisted", data, first.ID, first.ReleaseName)
	}
	if !strings.Contains(c.Reason, "blocklisted") {
		t.Errorf("reason = %q", c.Reason)
	}
	// The Release it blocklisted is searched for again, by the retry, and that says so.
	var retried bool
	for _, e := range eventsOf(t, hist, history.Searched) {
		retried = retried || (e.Trigger.Kind == history.TriggerRetry && strings.Contains(e.Reason, "navi"))
	}
	if !retried {
		t.Error("no Searched entry with trigger retry naming the person who canceled")
	}
}

func TestACancelWithoutBlocklistSaysSo(t *testing.T) {
	r := newRig(t)
	hist := r.logged(t)
	first := r.twoCandidates(t)

	if _, err := r.svc.Cancel(byPerson(), first.ID, false); err != nil {
		t.Fatal(err)
	}

	c := eventsOf(t, hist, history.GrabCanceled)[0]
	if strings.Contains(c.Message, "blocklisted") || strings.Contains(string(c.Data), `"blocklisted":true`) {
		t.Errorf("entry = %+v, want it not blocklisted", c)
	}
}

func TestEverySearchWritesOneEntryWithItsTrigger(t *testing.T) {
	r := newRig(t)
	hist := r.logged(t)
	r.publish(t, hd1080, 0)
	ver := r.wanted(t, slot.Standard)

	// The sweep, on its own.
	if _, err := r.svc.SearchWanted(history.WithTrigger(context.Background(), history.Job(history.TriggerSweep, "")), r.titleID, ver); err != nil {
		t.Fatal(err)
	}
	// A person's bulk Search: the sweep runs it with their trigger.
	r.cancelAll(t)
	if _, err := r.svc.SearchWanted(history.WithTrigger(context.Background(), history.Person("navi", "search from the Library")), r.titleID, ver); err != nil {
		t.Fatal(err)
	}
	// The search on add.
	r.cancelAll(t)
	if _, err := r.svc.SearchNew(context.Background(), r.titleID, ver); err != nil {
		t.Fatal(err)
	}

	got := eventsOf(t, hist, history.Searched)
	if len(got) != 3 {
		t.Fatalf("%d Searched entries, want one per search: %+v", len(got), got)
	}
	for i, want := range []struct {
		kind   history.TriggerKind
		reason string
	}{{history.TriggerSweep, "due"}, {history.TriggerPerson, "bulk: navi"}, {history.TriggerSweep, "new"}} {
		if got[i].Trigger.Kind != want.kind || !strings.HasPrefix(got[i].Reason, want.reason) {
			t.Errorf("entry %d = trigger %+v, reason %q, want %s and %q", i, got[i].Trigger, got[i].Reason, want.kind, want.reason)
		}
	}
}

// cancelAll cancels the active Grabs so the next search has something to do.
func (r *rig) cancelAll(t *testing.T) {
	t.Helper()
	for _, a := range r.active(t) {
		if _, err := r.svc.Cancel(byPerson(), a.ID, false); err != nil {
			t.Fatal(err)
		}
	}
}
