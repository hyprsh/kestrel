package api_test

import (
	"fmt"
	"testing"

	"github.com/hyprsh/kestrel/internal/jobs"
)

type eventJSON struct {
	ID        int64  `json:"id"`
	Kind      string `json:"kind"`
	TitleID   *int64 `json:"title_id"`
	VersionID *int64 `json:"version_id"`
	Message   string `json:"message"`
	Routine   bool   `json:"routine"`
}

type eventsJSON struct {
	Items []eventJSON `json:"items"`
}

func (e eventsJSON) kinds() []string {
	var out []string
	for _, x := range e.Items {
		out = append(out, x.Kind)
	}
	return out
}

func (s *search) events(t *testing.T, query string) eventsJSON {
	t.Helper()
	r := s.valid("GET", "/events"+query, "")
	if r.Status != 200 {
		t.Fatalf("GET /events%s = %d %s", query, r.Status, r.Body)
	}
	return decode[eventsJSON](t, r)
}

func TestTheLogFiltersByKindTitleAndSlotAndHidesRoutineEventsUnlessAsked(t *testing.T) {
	s := newSearch(t)
	s.publish(t, goodRelease)
	s.publish(t, uhdRelease)
	if r := s.grab(s.hd, s.releases(t, s.hd).find(t, goodRelease).ReleaseID, false); r.Status != 201 {
		t.Fatalf("grab = %d %s", r.Status, r.Body)
	}
	if r := s.grab(s.uhd, s.releases(t, s.uhd).find(t, uhdRelease).ReleaseID, false); r.Status != 201 {
		t.Fatalf("grab = %d %s", r.Status, r.Body)
	}
	if _, err := s.in.st.Write().Exec(`INSERT INTO events (at, kind, routine, title_id, version_id, message) VALUES ('2026-10-17T12:00:00Z', 'grab_completed', 1, ?, ?, 'finished')`, s.title, s.hd); err != nil {
		t.Fatal(err)
	}
	if _, err := s.in.st.Write().Exec(`INSERT INTO events (at, kind, routine, message) VALUES ('2026-10-17T12:00:00Z', 'health_raised', 0, 'unrelated')`); err != nil {
		t.Fatal(err)
	}

	shown := s.events(t, "")
	if len(shown.Items) != 3 {
		t.Errorf("default Log = %v, want the two grabs and the unrelated event, no routine one", shown.kinds())
	}
	for _, e := range shown.Items {
		if e.Routine {
			t.Errorf("a routine event is shown by default: %+v", e)
		}
	}
	if got := s.events(t, "?routine=true").kinds(); len(got) != 4 {
		t.Errorf("Log with routine = %v, want 4", got)
	}
	if got := s.events(t, "?kind=grab").Items; len(got) != 2 {
		t.Errorf("kind=grab = %+v", got)
	}
	hd := s.events(t, "?slot=standard")
	if len(hd.Items) != 1 || hd.Items[0].VersionID == nil || *hd.Items[0].VersionID != s.hd {
		t.Errorf("slot=standard = %+v, want the Standard grab only", hd.Items)
	}
	if got := s.events(t, "?slot=standard&routine=true").Items; len(got) != 2 {
		t.Errorf("slot=standard with routine = %+v", got)
	}
	if got := s.events(t, fmt.Sprintf("?title_id=%d", s.title)).Items; len(got) != 2 {
		t.Errorf("title filter = %+v", got)
	}
	if got := s.events(t, "?title_id=9999").Items; len(got) != 0 {
		t.Errorf("unknown title = %+v", got)
	}
	all := s.events(t, "?routine=true").Items
	if all[0].ID < all[len(all)-1].ID {
		t.Errorf("the Log is not newest first: %+v", all)
	}
	if r := s.valid("GET", "/events?slot=xl", ""); r.Status != 422 && r.Status != 400 {
		t.Errorf("a bad slot = %d", r.Status)
	}
}

type blocklistJSON struct {
	Items []struct {
		ID          int64  `json:"id"`
		ReleaseName string `json:"release_name"`
		Reason      string `json:"reason"`
		TitleID     *int64 `json:"title_id"`
	} `json:"items"`
}

func TestRemovingABlocklistEntryLetsTheReleaseBeGrabbedAgain(t *testing.T) {
	s := newSearch(t)
	s.publish(t, goodRelease)
	s.pass(t, jobs.Search)
	first := s.queue(t)[0]
	if r := s.valid("POST", fmt.Sprintf("/grabs/%d/cancel", first.GrabID), `{"blocklist":true}`); r.Status != 204 {
		t.Fatalf("cancel = %d %s", r.Status, r.Body)
	}

	list := decode[blocklistJSON](t, s.valid("GET", "/blocklist", ""))
	if len(list.Items) != 1 || list.Items[0].ReleaseName != goodRelease || list.Items[0].TitleID == nil || *list.Items[0].TitleID != s.title {
		t.Fatalf("blocklist = %+v", list)
	}
	if got := decode[blocklistJSON](t, s.valid("GET", "/blocklist?title_id=9999", "")); len(got.Items) != 0 {
		t.Errorf("blocklist of another Title = %+v", got)
	}
	if got := s.events(t, "?kind=blocklist").Items; len(got) != 1 {
		t.Errorf("the Log shows %+v for the Blocklist entry, want one", got)
	}

	if r := s.valid("DELETE", fmt.Sprintf("/blocklist/%d", list.Items[0].ID), ""); r.Status != 204 {
		t.Fatalf("delete = %d %s", r.Status, r.Body)
	}

	again := s.releases(t, s.hd).find(t, goodRelease)
	if len(again.Rejections) != 0 {
		t.Fatalf("rejections = %+v, want none", again.Rejections)
	}
	if r := s.grab(s.hd, again.ReleaseID, false); r.Status != 201 {
		t.Errorf("grab after removal = %d %s", r.Status, r.Body)
	}
	if r := s.valid("DELETE", fmt.Sprintf("/blocklist/%d", list.Items[0].ID), ""); r.Status != 404 {
		t.Errorf("second delete = %d, want 404", r.Status)
	}
}
