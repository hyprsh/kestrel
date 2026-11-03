package api_test

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/hyprsh/kestrel/internal/jobs"
)

// searchFinished is the `search_finished` frame.
type searchFinished struct {
	SearchID  string   `json:"search_id"`
	VersionID int64    `json:"version_id"`
	TitleID   int64    `json:"title_id"`
	Title     string   `json:"title"`
	Upgrade   bool     `json:"upgrade"`
	Outcome   string   `json:"outcome"`
	Grabbed   []string `json:"grabbed"`
}

// finished waits for the `search_finished` frame of the search id.
func (s *sseStream) finished(id string) searchFinished {
	s.t.Helper()
	var got searchFinished
	s.until("search_finished for "+id, func(e sseEvent) bool {
		return e.Name == "search_finished" && json.Unmarshal([]byte(e.Data), &got) == nil && got.SearchID == id
	})
	return got
}

func searchID(t *testing.T, r reply) string {
	t.Helper()
	if r.Status != 202 {
		t.Fatalf("POST search = %d %s, want 202", r.Status, r.Body)
	}
	id := decode[struct {
		SearchID string `json:"search_id"`
	}](t, r).SearchID
	if id == "" {
		t.Fatalf("POST search answered no search_id: %s", r.Body)
	}
	return id
}

func TestSearchNowSendsSearchFinishedNamingTheReleasesItGrabbed(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t, fastStream)
	s.addPaddington(t)
	s.publish(t, goodRelease)
	st := s.stream(t)

	id := searchID(t, s.searchNow(s.hd, ""))

	got := st.finished(id)
	if got.Outcome != "grabbed" || len(got.Grabbed) != 1 || got.Grabbed[0] != goodRelease || got.VersionID != s.hd || got.TitleID != s.title || got.Title == "" || got.Upgrade {
		t.Errorf("search_finished = %+v, want %q grabbed for the Version", got, goodRelease)
	}
}

func TestSearchNowSendsSearchFinishedWhenNothingFit(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t, fastStream)
	s.addPaddington(t)
	st := s.stream(t)

	id := searchID(t, s.searchNow(s.hd, ""))

	got := st.finished(id)
	if got.Outcome != "none" || len(got.Grabbed) != 0 {
		t.Errorf("search_finished = %+v, want none", got)
	}
}

func TestAnUpgradeSearchSendsSearchFinishedWhenNothingBetterTurnedUp(t *testing.T) {
	t.Parallel()
	s := newSeriesSearch(t)
	s.prober.set(goodProbe(), nil)
	s.publishEpisode(t, badEp1, "1", "1")
	s.pass(t, jobs.Search)
	s.finish(t, badEp1, "breaking.bad.s01e01.mkv")
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)
	pilot := s.heat(t)[1]
	st := s.stream(t)

	id := searchID(t, s.searchNow(s.hdVersion, fmt.Sprintf(`{"season":1,"episode_ids":[%d],"upgrade":true}`, pilot.ID)))

	got := st.finished(id)
	if got.Outcome != "none" || !got.Upgrade || len(got.Grabbed) != 0 || got.VersionID != s.hdVersion {
		t.Errorf("search_finished = %+v, want an Upgrade search that found nothing better", got)
	}
}
