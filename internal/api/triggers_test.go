package api_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/jobs"
)

type triggerEventJSON struct {
	Kind    string `json:"kind"`
	Message string `json:"message"`
	Reason  string `json:"reason"`
	Trigger *struct {
		Kind  string  `json:"kind"`
		Actor *string `json:"actor"`
		Via   *string `json:"via"`
	} `json:"trigger"`
	Data map[string]any `json:"data"`
}

func (s *search) triggerEvents(t *testing.T, kind string) []triggerEventJSON {
	t.Helper()
	r := s.valid("GET", "/events?routine=true&kind="+kind, "")
	if r.Status != 200 {
		t.Fatalf("GET /events = %d %s", r.Status, r.Body)
	}
	return decode[struct {
		Items []triggerEventJSON `json:"items"`
	}](t, r).Items
}

func TestABulkSearchLeavesOneEntryNamingThePersonAndTheCount(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	s.addMovie(t, `{"slot":"standard","profile":"hd-primary"}`)
	s.pass(t, jobs.Search)
	s.publish(t, goodRelease)

	r := s.valid("POST", "/titles/bulk", fmt.Sprintf(`{"action":"search","title_ids":[%d,999]}`, s.title))
	if r.Status != 200 {
		t.Fatalf("bulk = %d %s", r.Status, r.Body)
	}

	bulk := s.triggerEvents(t, "bulk")
	if len(bulk) != 1 {
		t.Fatalf("%d bulk entries, want exactly one: %+v", len(bulk), bulk)
	}
	b := bulk[0]
	if b.Trigger == nil || b.Trigger.Kind != "person" || b.Trigger.Actor == nil || *b.Trigger.Actor == "" || b.Trigger.Via == nil || *b.Trigger.Via != "BulkTitles" {
		t.Errorf("trigger = %+v, want the person and the BulkTitles call", b.Trigger)
	}
	if b.Data["action"] != "search" || b.Data["titles"] != float64(2) || b.Data["changed"] != float64(1) {
		t.Errorf("data = %v, want the action and the 2 Titles named", b.Data)
	}
	if !strings.Contains(b.Reason, "Search") || !strings.Contains(b.Reason, "2") {
		t.Errorf("reason = %q", b.Reason)
	}

	// The sweep that then runs the search says whose request it was.
	s.pass(t, jobs.Search)
	var found bool
	for _, e := range s.triggerEvents(t, "search") {
		found = found || (e.Trigger != nil && e.Trigger.Kind == "person" && strings.HasPrefix(e.Reason, "bulk: "))
	}
	if !found {
		t.Errorf("no Searched entry from the bulk request: %+v", s.triggerEvents(t, "search"))
	}
}

func TestACancelThroughTheAPIKeepsTheGrabAndThePerson(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.publish(t, goodRelease)
	s.pass(t, jobs.Search)
	first := s.queue(t)[0]

	if r := s.valid("POST", fmt.Sprintf("/grabs/%d/cancel", first.GrabID), `{"blocklist":true}`); r.Status != 204 {
		t.Fatalf("cancel = %d %s", r.Status, r.Body)
	}

	canceled := s.triggerEvents(t, "grab_canceled")
	if len(canceled) != 1 {
		t.Fatalf("%d grab_canceled entries: %+v", len(canceled), canceled)
	}
	c := canceled[0]
	if c.Trigger == nil || c.Trigger.Kind != "person" || c.Trigger.Via == nil || *c.Trigger.Via != "CancelGrab" {
		t.Errorf("trigger = %+v, want the person and CancelGrab", c.Trigger)
	}
	if c.Data["grab_id"] != float64(first.GrabID) || c.Data["blocklisted"] != true || c.Data["release"] != first.ReleaseName {
		t.Errorf("data = %v, want the Grab id, Release and the blocklisting", c.Data)
	}
}
