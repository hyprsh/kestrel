package api_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/plugin"
)

type budgetStatusJSON struct {
	Indexers []struct {
		InstanceID        int64      `json:"instance_id"`
		Name              string     `json:"name"`
		State             string     `json:"state"`
		SearchUsed        int        `json:"search_used"`
		SearchMax         *int       `json:"search_max"`
		SearchPausedUntil *time.Time `json:"search_paused_until"`
		GrabUsed          *int       `json:"grab_used"`
		GrabMax           *int       `json:"grab_max"`
		GrabsPaused       bool       `json:"grabs_paused"`
		GrabsPausedUntil  *time.Time `json:"grabs_paused_until"`
	} `json:"indexers"`
}

func TestTheHealthStripShowsBudgetsAndPausesAndNeitherCountsAsAFailure(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.publish(t, goodRelease)
	s.releases(t, s.hd)

	st := decode[budgetStatusJSON](t, s.valid("GET", "/system/status", ""))
	if len(st.Indexers) != 1 || st.Indexers[0].SearchUsed < 1 || st.Indexers[0].SearchMax != nil || st.Indexers[0].SearchPausedUntil != nil || st.Indexers[0].GrabsPaused {
		t.Fatalf("before any limit = %+v", st.Indexers)
	}

	s.idx.Exhaust(plugin.LimitSearch, 30*time.Minute)
	s.releases(t, s.hd)
	s.checks(t)

	st = decode[budgetStatusJSON](t, s.valid("GET", "/system/status", ""))
	ix := st.Indexers[0]
	if want := s.in.clock.Now().Add(30 * time.Minute); ix.SearchPausedUntil == nil || !ix.SearchPausedUntil.Equal(want) {
		t.Errorf("search_paused_until = %v, want %v", ix.SearchPausedUntil, want)
	}
	if ix.State != "ok" {
		t.Errorf("a pause is not a failure: state = %q", ix.State)
	}
	att := s.attention(t)
	if att.has("indexer_failing") || att.has("no_indexer") {
		t.Errorf("rows = %v: pauses must not raise Indexer failing or No indexer can search", att.kinds())
	}
}

func TestTheHealthStripShowsTheConfiguredGrabLimitAndPausesAtTheNextUTCMidnight(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.publish(t, goodRelease)
	st := decode[budgetStatusJSON](t, s.valid("GET", "/system/status", ""))
	if len(st.Indexers) != 1 {
		t.Fatalf("indexers = %+v", st.Indexers)
	}
	id := st.Indexers[0].InstanceID
	if r := s.valid("PATCH", fmt.Sprintf("/plugin-instances/%d", id), `{"config":{"api_key":"ik","grabs_per_day":1}}`); r.Status != 200 {
		t.Fatalf("PATCH = %d %s", r.Status, r.Body)
	}
	good := s.releases(t, s.hd).find(t, goodRelease)
	if r := s.grab(s.hd, good.ReleaseID, false); r.Status != 201 {
		t.Fatalf("POST /grabs = %d %s", r.Status, r.Body)
	}

	ix := decode[budgetStatusJSON](t, s.valid("GET", "/system/status", "")).Indexers[0]
	if ix.GrabUsed == nil || *ix.GrabUsed != 1 || ix.GrabMax == nil || *ix.GrabMax != 1 || !ix.GrabsPaused {
		t.Fatalf("row = %+v", ix)
	}
	now := s.in.clock.Now().UTC()
	if want := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, time.UTC); ix.GrabsPausedUntil == nil || !ix.GrabsPausedUntil.Equal(want) {
		t.Errorf("grabs_paused_until = %v, want %v", ix.GrabsPausedUntil, want)
	}
}
