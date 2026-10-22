package api_test

import (
	"fmt"
	"slices"
	"testing"
)

func TestAManualSearchNamesTheEpisodesOfAReleaseInThePrimaryLanguageAndTBAForUnlistedOnes(t *testing.T) {
	t.Parallel()
	s := newSeriesSearch(t)
	s.valid("PATCH", "/settings", `{"language_region":{"primary_language":"de"}}`)
	if r := s.valid("POST", fmt.Sprintf("/titles/%d/refresh", s.title), ""); r.Status != 202 {
		t.Fatalf("POST refresh = %d %s", r.Status, r.Body)
	}
	const (
		listed   = "Breaking.Bad.S01E01.1080p.WEB-DL.H264-GRP"
		unlisted = "Breaking.Bad.S02E06.1080p.WEB-DL.H264-GRP"
	)
	s.publishEpisode(t, listed, "1", "1")
	s.publishEpisode(t, unlisted, "2", "6")

	type item struct {
		Name          string   `json:"name"`
		Episodes      []int    `json:"episodes"`
		EpisodeTitles []string `json:"episode_titles"`
	}
	titles := func(name string) []string {
		list := decode[struct {
			Items []item `json:"items"`
		}](t, s.valid("POST", fmt.Sprintf("/versions/%d/releases", s.hdVersion), ""))
		for _, it := range list.Items {
			if it.Name == name {
				return it.EpisodeTitles
			}
		}
		t.Fatalf("no %q among the releases", name)
		return nil
	}
	eventually(t, "the German episode titles", func() bool { return slices.Equal(titles(listed), []string{"Der Einstieg"}) })
	if got := titles(unlisted); !slices.Equal(got, []string{"TBA"}) {
		t.Errorf("S02E06 titles = %q, want TBA", got)
	}

	// Once a Grab adds S02E06 as a Placeholder Episode it is still TBA.
	var rel string
	for _, it := range decode[releaseListJSON](t, s.valid("POST", fmt.Sprintf("/versions/%d/releases", s.hdVersion), "")).Items {
		if it.Name == unlisted {
			rel = it.ReleaseID
		}
	}
	if r := s.grab(s.hdVersion, rel, true); r.Status != 201 {
		t.Fatalf("grab = %d %s", r.Status, r.Body)
	}
	if got := titles(unlisted); !slices.Equal(got, []string{"TBA"}) {
		t.Errorf("Placeholder Episode titles = %q, want TBA", got)
	}
}
