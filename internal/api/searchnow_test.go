package api_test

import (
	"fmt"
	"testing"
)

func (s search) searchNow(version int64, body string) reply {
	return s.valid("POST", fmt.Sprintf("/versions/%d/search", version), body)
}

func TestSearchNowAnswersAtOnceAndGrabsTheBestReleaseInTheBackground(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.publish(t, goodRelease)

	if r := s.searchNow(s.hd, ""); r.Status != 202 {
		t.Fatalf("POST search = %d %s", r.Status, r.Body)
	}

	eventually(t, "the Grab", func() bool {
		q := s.queue(t)
		return len(q) == 1 && q[0].ReleaseName == goodRelease && *q[0].VersionID == s.hd
	})
	eventually(t, "the search in the Log", func() bool {
		return len(s.events(t, fmt.Sprintf("?kind=search&routine=true&title_id=%d", s.title)).Items) == 1
	})
}

func TestSearchNowOfOneEpisodeGrabsOnlyThatEpisode(t *testing.T) {
	t.Parallel()
	s := newSeriesSearch(t)
	s.publishEpisode(t, badEp1, "1", "1")
	s.publishEpisode(t, "Breaking.Bad.S01E02.1080p.WEB-DL.H264-GRP", "1", "2")
	second := s.heat(t)[2]

	if r := s.searchNow(s.hdVersion, fmt.Sprintf(`{"season":1,"episode_ids":[%d]}`, second.ID)); r.Status != 202 {
		t.Fatalf("POST search = %d %s", r.Status, r.Body)
	}

	eventually(t, "the search in the Log", func() bool {
		return len(s.events(t, fmt.Sprintf("?kind=search&routine=true&title_id=%d", s.title)).Items) == 1
	})
	if q := s.queue(t); len(q) != 1 || len(q[0].Episodes) != 1 || q[0].Episodes[0] != "S01E02" {
		t.Fatalf("queue = %+v, want only S01E02", q)
	}
}

func TestSearchNowRefusesAScopeTheSeriesLacksAndAnUnknownVersion(t *testing.T) {
	t.Parallel()
	s := newSeriesSearch(t)
	pilot := s.heat(t)[1]

	for body, field := range map[string]string{
		`{"season":9}`:             "season",
		`{"episode_ids":[987654]}`: "episode_ids",
		fmt.Sprintf(`{"season":2,"episode_ids":[%d]}`, pilot.ID): "episode_ids",
	} {
		r := s.searchNow(s.hdVersion, body)
		got := decode[struct {
			Errors []struct {
				Field string `json:"field"`
			} `json:"errors"`
		}](t, r)
		if r.Status != 422 || len(got.Errors) != 1 || got.Errors[0].Field != field {
			t.Errorf("%s = %d %s, want 422 on %s", body, r.Status, r.Body, field)
		}
	}
	if r := s.searchNow(987654, ""); r.Status != 404 {
		t.Errorf("unknown Version = %d %s", r.Status, r.Body)
	}
}
