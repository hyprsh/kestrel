package api_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/plugin"
)

type searchStatusJSON struct {
	Due struct {
		Versions int `json:"versions"`
		Episodes int `json:"episodes"`
		Upgrades int `json:"upgrades"`
	} `json:"due"`
	Pass *struct {
		Done  int `json:"done"`
		Total int `json:"total"`
	} `json:"pass"`
	NextPassAt *time.Time `json:"next_pass_at"`
	LastPass   *struct {
		FinishedAt time.Time `json:"finished_at"`
		Searched   int       `json:"searched"`
		Grabbed    int       `json:"grabbed"`
	} `json:"last_pass"`
	UpgradesPerPass int `json:"upgrades_per_pass"`
	Indexers        []struct {
		Name       string     `json:"name"`
		SearchUsed int        `json:"search_used"`
		SearchMax  *int       `json:"search_max"`
		Held       *string    `json:"held"`
		HeldUntil  *time.Time `json:"held_until"`
	} `json:"indexers"`
}

func (s search) searchStatus(t *testing.T) searchStatusJSON {
	t.Helper()
	r := s.valid("GET", "/search/status", "")
	if r.Status != 200 {
		t.Fatalf("GET /search/status = %d %s", r.Status, r.Body)
	}
	return decode[searchStatusJSON](t, r)
}

func TestTheSearchStatusSaysHowTheLastPassWent(t *testing.T) {
	t.Parallel()
	s := newSearch(t) // Paddington in Standard and 4K: two Wanted Versions
	s.publish(t, goodRelease)

	before := s.searchStatus(t)
	if before.LastPass != nil || before.Pass != nil || before.UpgradesPerPass != 5 {
		t.Fatalf("before any pass = %+v", before)
	}

	s.pass(t, jobs.Search)

	st := s.searchStatus(t)
	if st.LastPass == nil || st.LastPass.Searched != 2 || st.LastPass.Grabbed != 1 || !st.LastPass.FinishedAt.Equal(s.in.clock.Now()) {
		t.Errorf("last pass = %+v, want both Versions searched and the 1080p Release grabbed now", st.LastPass)
	}
	if st.Pass != nil || st.Due.Versions != 0 {
		t.Errorf("status = %+v, want no pass running and nothing waiting", st)
	}
	if len(st.Indexers) != 1 || st.Indexers[0].Name != "Alpha" || st.Indexers[0].SearchUsed < 1 || st.Indexers[0].SearchMax != nil || st.Indexers[0].Held != nil {
		t.Errorf("indexers = %+v, want Alpha with its searches counted, no known budget and nothing holding it", st.Indexers)
	}
}

func TestTheSearchStatusSaysWhenAnIndexerIsPausedAndUntilWhen(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.idx.Exhaust(plugin.LimitSearch, 30*time.Minute)
	s.releases(t, s.hd)

	ix := s.searchStatus(t).Indexers[0]

	if want := s.in.clock.Now().Add(30 * time.Minute); ix.Held == nil || *ix.Held != "request_limit" || ix.HeldUntil == nil || !ix.HeldUntil.Equal(want) {
		t.Errorf("indexer = %+v, want it held by its request limit until %v", ix, want)
	}
}

func TestTheStreamSendsTheSearchStatusWhenItChanges(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t, fastStream)
	s.addPaddington(t)
	st := s.stream(t)
	st.until("a search frame", func(e sseEvent) bool { return e.Name == "search" })

	st.mark()
	s.pass(t, jobs.Search)

	st.until("a search frame with the last pass", func(e sseEvent) bool {
		var v searchStatusJSON
		return e.Name == "search" && json.Unmarshal([]byte(e.Data), &v) == nil && v.LastPass != nil && v.LastPass.Searched == 2
	})
}
