package api_test

import (
	"fmt"
	"strings"
	"testing"
)

// one returns the only entry of the kind, failing when there are none or several.
func (s *search) one(t *testing.T, kind string) triggerEventJSON {
	t.Helper()
	es := s.triggerEvents(t, kind)
	if len(es) != 1 {
		t.Fatalf("%d %q entries, want exactly one: %+v", len(es), kind, es)
	}
	return es[0]
}

// byPerson fails unless the entry names the signed-in person and the API call.
func byPerson(t *testing.T, e triggerEventJSON, via string) {
	t.Helper()
	if e.Trigger == nil || e.Trigger.Kind != "person" || e.Trigger.Actor == nil || *e.Trigger.Actor == "" || e.Trigger.Via == nil || *e.Trigger.Via != via {
		t.Errorf("%s trigger = %+v, want the person and %s", e.Kind, e.Trigger, via)
	}
	if !strings.HasPrefix(e.Reason, "chosen by hand: ") {
		t.Errorf("%s reason = %q, want it to say it was chosen by hand", e.Kind, e.Reason)
	}
}

func TestAddingAndRemovingATitleAndVersionByHandEachWriteOneEntry(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	s.addMovie(t, `{"slot":"standard","profile":"hd-primary"}`)

	added := s.one(t, "title_added")
	byPerson(t, added, "CreateTitle")
	if !strings.Contains(added.Message, "Movie") || !strings.Contains(added.Reason, "added to the Library") {
		t.Errorf("title_added = %q / %q", added.Message, added.Reason)
	}

	if r := s.valid("POST", fmt.Sprintf("/titles/%d/versions", s.title), `{"slot":"4k","profile":"4k-primary"}`); r.Status != 201 {
		t.Fatalf("add Version = %d %s", r.Status, r.Body)
	}
	v := s.one(t, "version_added")
	byPerson(t, v, "AddVersion")
	if v.Data["slot"] != "4k" || v.Data["profile"] != "4k-primary" {
		t.Errorf("version_added data = %v", v.Data)
	}

	if r := s.valid("DELETE", fmt.Sprintf("/versions/%d", s.hd), ""); r.Status != 204 {
		t.Fatalf("remove Version = %d %s", r.Status, r.Body)
	}
	gone := s.one(t, "version_removed")
	byPerson(t, gone, "DeleteVersion")
	if gone.Data["version_id"] != float64(s.hd) || gone.Data["slot"] != "standard" {
		t.Errorf("version_removed data = %v, want the removed Version", gone.Data)
	}

	if r := s.valid("DELETE", fmt.Sprintf("/titles/%d", s.title), ""); r.Status != 204 {
		t.Fatalf("remove Title = %d %s", r.Status, r.Body)
	}
	removed := s.one(t, "title_removed")
	byPerson(t, removed, "DeleteTitle")
	if removed.Data["title_id"] != float64(s.title) || removed.Data["versions"] != float64(1) {
		t.Errorf("title_removed data = %v, want the Title id and its Versions", removed.Data)
	}
}

func TestMonitoringAMovieByHandWritesOneEntryAndAnUnchangedOneNone(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	s.addMovie(t, `{"slot":"standard","profile":"hd-primary"}`)
	path := fmt.Sprintf("/titles/%d", s.title)

	if r := s.valid("PATCH", path, `{"monitored":true}`); r.Status != 200 {
		t.Fatalf("PATCH = %d %s", r.Status, r.Body)
	}
	if es := s.triggerEvents(t, "monitoring"); len(es) != 0 {
		t.Fatalf("monitoring an already monitored Movie wrote %+v", es)
	}
	if r := s.valid("PATCH", path, `{"monitored":false}`); r.Status != 200 {
		t.Fatalf("PATCH = %d %s", r.Status, r.Body)
	}
	e := s.one(t, "monitoring")
	byPerson(t, e, "PatchTitle")
	if e.Data["scope"] != "title" || e.Data["monitored"] != false || !strings.Contains(e.Message, "unmonitored") {
		t.Errorf("monitoring = %q %v", e.Message, e.Data)
	}
}

func TestASeasonAndEpisodesMonitoredByHandWriteTheirOwnEntries(t *testing.T) {
	t.Parallel()
	s := newSeriesSearch(t)

	if r := s.valid("PATCH", fmt.Sprintf("/titles/%d/seasons/1", s.title), `{"monitored":false}`); r.Status != 204 {
		t.Fatalf("PATCH season = %d %s", r.Status, r.Body)
	}
	season := s.one(t, "monitoring")
	byPerson(t, season, "PatchSeason")
	if season.Data["scope"] != "season" || season.Data["season"] != float64(1) || season.Data["monitored"] != false {
		t.Errorf("season entry = %q %v", season.Message, season.Data)
	}

	eps := decode[struct {
		Items []struct {
			ID int64 `json:"id"`
		} `json:"items"`
	}](t, s.valid("GET", fmt.Sprintf("/titles/%d/episodes", s.title), "")).Items
	body := fmt.Sprintf(`{"episode_ids":[%d,%d],"monitored":true}`, eps[0].ID, eps[1].ID)
	if r := s.valid("POST", fmt.Sprintf("/titles/%d/episodes/monitor", s.title), body); r.Status != 204 {
		t.Fatalf("PATCH episodes = %d %s", r.Status, r.Body)
	}
	var found bool
	for _, e := range s.triggerEvents(t, "monitoring") {
		if e.Data["scope"] == "episodes" {
			found = true
			byPerson(t, e, "MonitorEpisodes")
			if !strings.Contains(e.Message, "2 episodes") {
				t.Errorf("episodes entry = %q", e.Message)
			}
		}
	}
	if !found {
		t.Errorf("no episodes entry: %+v", s.triggerEvents(t, "monitoring"))
	}
}

func TestABulkActionWritesOneEntryAndNoneForEachTitle(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	s.addMovie(t, `{"slot":"standard","profile":"hd-primary"}`)

	for _, body := range []string{
		fmt.Sprintf(`{"action":"monitor","title_ids":[%d],"monitored":false}`, s.title),
		fmt.Sprintf(`{"action":"add_version","title_ids":[%d],"slot":"4k","profile":"4k-primary"}`, s.title),
		fmt.Sprintf(`{"action":"remove_version","title_ids":[%d],"slot":"4k"}`, s.title),
		fmt.Sprintf(`{"action":"remove","title_ids":[%d]}`, s.title),
	} {
		if r := s.valid("POST", "/titles/bulk", body); r.Status != 200 {
			t.Fatalf("bulk %s = %d %s", body, r.Status, r.Body)
		}
	}

	if n := len(s.triggerEvents(t, "bulk")); n != 4 {
		t.Errorf("%d bulk entries, want one per call (4)", n)
	}
	for _, kind := range []string{"monitoring", "version_added", "version_removed", "title_removed"} {
		if es := s.triggerEvents(t, kind); len(es) != 0 {
			t.Errorf("a bulk action also wrote %d %q entries: %+v", len(es), kind, es)
		}
	}
	// The one entry says what happened to each Title.
	items, _ := s.triggerEvents(t, "bulk")[0].Data["items"].([]any)
	if len(items) != 1 {
		t.Errorf("bulk data items = %v, want the one Title's outcome", items)
	}
}

func TestARequestAddsATitleUnderTheRequestTriggerNotThePerson(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)

	if r := s.valid("POST", "/requests", requestBody("r-1", "movie", 116149, dualSlots, "null")); r.Status != 201 {
		t.Fatalf("POST /requests = %d %s", r.Status, r.Body)
	}

	added := s.one(t, "title_added")
	if added.Trigger == nil || added.Trigger.Kind != "request" || added.Trigger.Via == nil || *added.Trigger.Via != "Silo" {
		t.Errorf("trigger = %+v, want a Request from Silo", added.Trigger)
	}
	if !strings.HasPrefix(added.Reason, "request: asked for via Silo") {
		t.Errorf("reason = %q", added.Reason)
	}
}
