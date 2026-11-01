package api_test

import (
	"fmt"
	"testing"
	"time"

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
	t.Parallel()
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

func TestTheLogMatchesAnyOfSeveralKindsTitlesAndSlotsAndLeavesOutExcludedKinds(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.publish(t, goodRelease)
	s.publish(t, uhdRelease)
	if r := s.grab(s.hd, s.releases(t, s.hd).find(t, goodRelease).ReleaseID, false); r.Status != 201 {
		t.Fatalf("grab = %d %s", r.Status, r.Body)
	}
	if r := s.grab(s.uhd, s.releases(t, s.uhd).find(t, uhdRelease).ReleaseID, false); r.Status != 201 {
		t.Fatalf("grab = %d %s", r.Status, r.Body)
	}
	for _, kind := range []string{"health_raised", "import_rejected"} {
		if _, err := s.in.st.Write().Exec(`INSERT INTO events (at, kind, routine, message) VALUES ('2026-10-17T12:00:00Z', ?, 0, 'unrelated')`, kind); err != nil {
			t.Fatal(err)
		}
	}

	if got := s.events(t, "?kind=grab&kind=health_raised").kinds(); len(got) != 3 {
		t.Errorf("kind=grab or health_raised = %v, want the two grabs and the warning", got)
	}
	if got := s.events(t, "?exclude_kind=grab&exclude_kind=health_raised").kinds(); len(got) != 1 || got[0] != "import_rejected" {
		t.Errorf("without grab and health_raised = %v, want the rejected import only", got)
	}
	if got := s.events(t, "?kind=grab&kind=import_rejected&exclude_kind=grab").kinds(); len(got) != 1 || got[0] != "import_rejected" {
		t.Errorf("an excluded kind wins over an included one: %v", got)
	}
	if got := s.events(t, "?slot=standard&slot=4k").Items; len(got) != 2 {
		t.Errorf("slot=standard or 4k = %+v, want both grabs", got)
	}
	if got := s.events(t, fmt.Sprintf("?title_id=9999&title_id=%d", s.title)).Items; len(got) != 2 {
		t.Errorf("title_id=9999 or the Title = %+v, want both grabs", got)
	}
	if r := s.valid("GET", "/events?slot=standard&slot=xl", ""); r.Status != 422 && r.Status != 400 {
		t.Errorf("a bad slot among good ones = %d", r.Status)
	}
}

func TestTheLogLeavesOutExcludedSlotsAndTitles(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.publish(t, goodRelease)
	s.publish(t, uhdRelease)
	if r := s.grab(s.hd, s.releases(t, s.hd).find(t, goodRelease).ReleaseID, false); r.Status != 201 {
		t.Fatalf("grab = %d %s", r.Status, r.Body)
	}
	if r := s.grab(s.uhd, s.releases(t, s.uhd).find(t, uhdRelease).ReleaseID, false); r.Status != 201 {
		t.Fatalf("grab = %d %s", r.Status, r.Body)
	}
	// About no Title or Version: neither exclusion leaves it out.
	if _, err := s.in.st.Write().Exec(`INSERT INTO events (at, kind, routine, message) VALUES ('2026-10-17T12:00:00Z', 'health_raised', 0, 'unrelated')`); err != nil {
		t.Fatal(err)
	}

	if got := s.events(t, "?exclude_slot=4k").Items; len(got) != 2 || got[0].Kind != "health_raised" || got[1].Kind != "grab" {
		t.Errorf("exclude_slot=4k = %+v, want the warning and the Standard grab", got)
	}
	if got := s.events(t, "?exclude_slot=standard&exclude_slot=4k").kinds(); len(got) != 1 || got[0] != "health_raised" {
		t.Errorf("exclude_slot=standard,4k = %v, want the warning only", got)
	}
	if got := s.events(t, fmt.Sprintf("?exclude_title_id=%d", s.title)).kinds(); len(got) != 1 || got[0] != "health_raised" {
		t.Errorf("exclude_title_id = %v, want the warning only", got)
	}
	if got := s.events(t, fmt.Sprintf("?title_id=%d&exclude_title_id=%d", s.title, s.title)).Items; len(got) != 0 {
		t.Errorf("an excluded Title wins over an included one: %+v", got)
	}
	if r := s.valid("GET", "/events?exclude_slot=xl", ""); r.Status != 422 && r.Status != 400 {
		t.Errorf("a bad excluded slot = %d", r.Status)
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
	t.Parallel()
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

func TestTheLogSummaryCountsEventsByKindIncludingRoutineOnes(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	for _, row := range []string{
		`('2026-10-17T12:00:00Z', 'health_raised', 0, 'a')`,
		`('2026-10-17T13:00:00Z', 'health_raised', 0, 'b')`,
		`('2026-10-17T14:00:00Z', 'search', 1, 'c')`,
	} {
		if _, err := s.in.st.Write().Exec(`INSERT INTO events (at, kind, routine, message) VALUES ` + row); err != nil {
			t.Fatal(err)
		}
	}
	r := s.valid("GET", "/events/summary", "")
	if r.Status != 200 {
		t.Fatalf("GET /events/summary = %d %s", r.Status, r.Body)
	}
	got := decode[struct {
		Counts []struct {
			Kind    string `json:"kind"`
			Count   int64  `json:"count"`
			Routine bool   `json:"routine"`
		} `json:"counts"`
		Oldest      *string `json:"oldest"`
		RoutineDays int     `json:"routine_days"`
	}](t, r)
	n := map[string]int64{}
	for _, c := range got.Counts {
		n[c.Kind] = c.Count
		if c.Routine != (c.Kind == "search") {
			t.Errorf("%s routine = %v", c.Kind, c.Routine)
		}
	}
	if n["health_raised"] != 2 || n["search"] != 1 {
		t.Errorf("counts = %v, want 2 health_raised and 1 search (routine included)", got.Counts)
	}
	if got.Oldest == nil || *got.Oldest != "2026-10-17T12:00:00Z" || got.RoutineDays != 30 {
		t.Errorf("oldest = %v, routine_days = %d", got.Oldest, got.RoutineDays)
	}
}

func TestTheLogHistogramCountsRecentEventsPerBucketBySeverity(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	// The tests' clock stands at noon on 2026-10-17.
	now := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	at := now.Add(-time.Hour).Format(time.RFC3339)
	old := now.Add(-30 * 24 * time.Hour).Format(time.RFC3339)
	for _, row := range [][2]string{{at, "grab"}, {at, "search"}, {at, "grab_failed"}, {at, "health_raised"}, {old, "grab_failed"}} {
		if _, err := s.in.st.Write().Exec(`INSERT INTO events (at, kind, routine, message) VALUES (?, ?, 0, 'x')`, row[0], row[1]); err != nil {
			t.Fatal(err)
		}
	}
	r := s.valid("GET", "/events/histogram?bucket=1h&days=2", "")
	if r.Status != 200 {
		t.Fatalf("GET /events/histogram = %d %s", r.Status, r.Body)
	}
	got := decode[struct {
		Bucket  string `json:"bucket"`
		Buckets []struct {
			At       string `json:"at"`
			Events   int64  `json:"events"`
			Warnings int64  `json:"warnings"`
			Errors   int64  `json:"errors"`
		} `json:"buckets"`
	}](t, r)
	var events, warnings, errs int64
	for _, b := range got.Buckets {
		events, warnings, errs = events+b.Events, warnings+b.Warnings, errs+b.Errors
	}
	if got.Bucket != "1h" || len(got.Buckets) < 48 || len(got.Buckets) > 50 {
		t.Errorf("bucket = %q with %d buckets, want 1h and about 49", got.Bucket, len(got.Buckets))
	}
	if events != 2 || warnings != 1 || errs != 1 {
		t.Errorf("totals = %d events, %d warnings, %d errors; want 2, 1 and 1 (the month-old failure is out of range)", events, warnings, errs)
	}

	for _, bad := range []string{"bucket=2h", "days=0", "days=91"} {
		if r := s.valid("GET", "/events/histogram?"+bad, ""); r.Status != 422 && r.Status != 400 {
			t.Errorf("GET /events/histogram?%s = %d, want a validation error", bad, r.Status)
		}
	}
}
