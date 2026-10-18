package api_test

import (
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/plugin"
)

type budgetStatusJSON struct {
	Indexers []struct {
		Name              string     `json:"name"`
		State             string     `json:"state"`
		SearchUsed        int        `json:"search_used"`
		SearchMax         *int       `json:"search_max"`
		SearchPausedUntil *time.Time `json:"search_paused_until"`
		GrabsPaused       bool       `json:"grabs_paused"`
		GrabsPausedUntil  *time.Time `json:"grabs_paused_until"`
	} `json:"indexers"`
}

func TestTheHealthStripShowsBudgetsAndPausesAndNeitherCountsAsAFailure(t *testing.T) {
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
