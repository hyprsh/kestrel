package api_test

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

// Breaking Bad's fixture lists S02E01-E03 and no season 4.

func TestAManualGrabBeyondTheLastListedEpisodeAddsAPlaceholderEpisodeTheSeriesPageMarks(t *testing.T) {
	t.Parallel()
	s := newSeriesSearch(t)
	const (
		beyond = "Breaking.Bad.S02E06.1080p.WEB-DL.H264-GRP"
		season = "Breaking.Bad.S04E01.1080p.WEB-DL.H264-GRP"
	)
	s.publishEpisode(t, beyond, "2", "6")
	s.publishEpisode(t, season, "4", "1")

	list := s.releases(t, s.hdVersion)
	b := list.find(t, beyond)
	if len(b.Rejections) != 1 || b.Rejections[0].Code != "episode_not_listed" || !b.Rejections[0].Overridable ||
		!strings.Contains(b.Rejections[0].Message, "TheTVDB") {
		t.Errorf("S02E06 rejections = %+v", b.Rejections)
	}
	sn := list.find(t, season)
	if len(sn.Rejections) != 1 || sn.Rejections[0].Code != "season_not_listed" || sn.Rejections[0].Overridable {
		t.Errorf("S04E01 rejections = %+v", sn.Rejections)
	}

	if r := s.grab(s.hdVersion, sn.ReleaseID, true); r.Status != 422 || !strings.Contains(string(r.Body), "not_overridable") {
		t.Fatalf("grab of an unlisted season = %d %s", r.Status, r.Body)
	}
	if r := s.grab(s.hdVersion, b.ReleaseID, false); r.Status != 422 || !strings.Contains(string(r.Body), `"rejected"`) {
		t.Fatalf("grab without override = %d %s", r.Status, r.Body)
	}
	if r := s.grab(s.hdVersion, b.ReleaseID, true); r.Status != 201 {
		t.Fatalf("grab with override = %d %s", r.Status, r.Body)
	}

	var found bool
	for _, e := range s.heat(t) {
		switch {
		case e.Season == 2 && e.Number == 6:
			found = true
			if !e.Placeholder || e.Name != "" || e.AirDate != nil || !e.Monitored {
				t.Errorf("S02E06 = %+v", e)
			}
		case e.Placeholder:
			t.Errorf("a listed episode is marked: %+v", e)
		}
	}
	if !found {
		t.Error("no Placeholder Episode S02E06")
	}
}

func TestARefreshKeepsThePlaceholderEpisodeAGrabIsFetching(t *testing.T) {
	t.Parallel()
	s := newSeriesSearch(t)
	const beyond = "Breaking.Bad.S02E06.1080p.WEB-DL.H264-GRP"
	s.publishEpisode(t, beyond, "2", "6")
	if r := s.grab(s.hdVersion, s.releases(t, s.hdVersion).find(t, beyond).ReleaseID, true); r.Status != 201 {
		t.Fatalf("grab = %d %s", r.Status, r.Body)
	}

	// A German household's refresh fetches the German episode titles, which shows it ran.
	s.valid("PATCH", "/settings", `{"language_region":{"primary_language":"de"}}`)
	s.trashPass(t)
	if r := s.valid("POST", fmt.Sprintf("/titles/%d/refresh", s.title), ""); r.Status != 202 {
		t.Fatalf("POST refresh = %d %s", r.Status, r.Body)
	}
	eventually(t, "the refresh", func() bool { return s.heat(t)[1].PrimaryName == "Der Einstieg" })
	if !slices.ContainsFunc(s.heat(t), func(e episodeJSON) bool { return e.Season == 2 && e.Number == 6 && e.Placeholder }) {
		t.Error("the refresh removed the Placeholder Episode the Grab is fetching")
	}
}
