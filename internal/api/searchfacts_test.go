package api_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/jobs"
)

type lastSearchJSON struct {
	At       time.Time `json:"at"`
	Releases int       `json:"releases"`
	Outcome  string    `json:"outcome"`
	Reasons  []struct {
		Code  string `json:"code"`
		Count int    `json:"count"`
	} `json:"reasons"`
	Upgrade bool `json:"upgrade"`
}

type searchedVersionJSON struct {
	ID           int64           `json:"id"`
	LastSearch   *lastSearchJSON `json:"last_search"`
	NextSearchAt *time.Time      `json:"next_search_at"`
}

func (s search) searched(t *testing.T) searchedVersionJSON {
	t.Helper()
	d := decode[struct {
		Versions []searchedVersionJSON `json:"versions"`
	}](t, s.valid("GET", fmt.Sprintf("/titles/%d", s.title), ""))
	for _, v := range d.Versions {
		if v.ID == s.hd {
			return v
		}
	}
	t.Fatalf("Title %d has no Version %d", s.title, s.hd)
	return searchedVersionJSON{}
}

func TestAVersionNeverSearchedHasNoLastSearchButADueSearch(t *testing.T) {
	t.Parallel()
	s := newSearch(t)

	v := s.searched(t)

	if v.LastSearch != nil {
		t.Errorf("last_search = %+v before any search, want none", v.LastSearch)
	}
	if v.NextSearchAt == nil {
		t.Error("next_search_at is empty, want the search that is due on add")
	}
}

func TestAVersionTellsWhatItsLastSearchFoundAndWhenTheNextIsDue(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.publish(t, goodRelease)
	s.pass(t, jobs.Search)

	v := s.searched(t)

	if v.LastSearch == nil || v.LastSearch.Outcome != "grabbed" || v.LastSearch.Releases < 1 || v.LastSearch.Upgrade {
		t.Fatalf("last_search = %+v, want a search that grabbed", v.LastSearch)
	}
	if v.NextSearchAt == nil || !v.NextSearchAt.After(v.LastSearch.At) {
		t.Errorf("next_search_at = %v, want it after the search at %v", v.NextSearchAt, v.LastSearch.At)
	}
}

func TestAVersionWhoseReleasesAllFailedCountsTheRejectionReasons(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.publish(t, "Paddington.2014.GERMAN.1080p.BluRay.x264-GRP")
	s.pass(t, jobs.Search)

	v := s.searched(t)

	if v.LastSearch == nil || v.LastSearch.Outcome != "nothing_fit" || v.LastSearch.Releases != 1 || len(v.LastSearch.Reasons) == 0 || v.LastSearch.Reasons[0].Count != 1 {
		t.Errorf("last_search = %+v, want nothing_fit over 1 release with a reason counted once", v.LastSearch)
	}
}

type factsStepsJSON struct {
	DownloadStartedAt  *time.Time `json:"download_started_at"`
	DownloadFinishedAt *time.Time `json:"download_finished_at"`
	Why                *struct {
		CoversWanted  int `json:"covers_wanted"`
		ReplacesFiles int `json:"replaces_files"`
		ScoreDelta    int `json:"score_delta"`
	} `json:"why"`
	Replaced *int `json:"replaced"`
}

func TestAnImportedGrabKeepsWhyItWasGrabbedWhatItReplacedAndWhenItDownloaded(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.prober.set(goodProbe(), nil)
	grab, _ := s.download(t, map[string]string{"paddington.mkv": "the movie"})
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)

	st := decode[factsStepsJSON](t, s.valid("GET", fmt.Sprintf("/grabs/%d/steps", grab), ""))

	if st.Why == nil || st.Why.CoversWanted != 1 || st.Why.ReplacesFiles != 0 {
		t.Errorf("why = %+v, want 1 Wanted covered and no file replaced", st.Why)
	}
	if st.Replaced == nil || *st.Replaced != 0 {
		t.Errorf("replaced = %v, want 0 (imported, replaced nothing)", st.Replaced)
	}
	if st.DownloadStartedAt == nil || st.DownloadFinishedAt == nil {
		t.Errorf("download times = %v, %v, want both from the Grab", st.DownloadStartedAt, st.DownloadFinishedAt)
	}
}

func TestAGrabListsTheEpisodeIdsItWasMadeFor(t *testing.T) {
	t.Parallel()
	s := newSeriesSearch(t)
	s.publishEpisode(t, badEp1, "1", "1")
	s.publishEpisode(t, "Breaking.Bad.S01E02.1080p.WEB-DL.H264-GRP", "1", "2")
	second := s.heat(t)[2]
	if r := s.searchNow(s.hdVersion, fmt.Sprintf(`{"season":1,"episode_ids":[%d]}`, second.ID)); r.Status != 202 {
		t.Fatalf("POST search = %d %s", r.Status, r.Body)
	}
	var ids []int64
	eventually(t, "the Grab in the queue", func() bool {
		q := decode[struct {
			Items []struct {
				EpisodeIDs []int64 `json:"episode_ids"`
			} `json:"items"`
		}](t, s.valid("GET", "/queue", ""))
		if len(q.Items) != 1 {
			return false
		}
		ids = q.Items[0].EpisodeIDs
		return true
	})

	if len(ids) != 1 || ids[0] != second.ID {
		t.Errorf("queue episode_ids = %v, want only %d", ids, second.ID)
	}
	l := decode[struct {
		Items []struct {
			EpisodeIDs []int64 `json:"episode_ids"`
		} `json:"items"`
	}](t, s.valid("GET", "/grabs", ""))
	if len(l.Items) != 1 || len(l.Items[0].EpisodeIDs) != 1 || l.Items[0].EpisodeIDs[0] != second.ID {
		t.Errorf("GET /grabs = %+v, want episode_ids [%d]", l.Items, second.ID)
	}
}

func TestAnEpisodeCellTellsWhatTheLastSearchForItFound(t *testing.T) {
	t.Parallel()
	s := newSeriesSearch(t)
	s.publishEpisode(t, badEp1, "1", "1")
	s.pass(t, jobs.Search)

	d := decode[struct {
		Items []struct {
			Season int `json:"season"`
			Number int `json:"number"`
			Cells  struct {
				Standard *struct {
					LastSearch *lastSearchJSON `json:"last_search"`
				} `json:"standard"`
			} `json:"cells"`
		} `json:"items"`
	}](t, s.valid("GET", fmt.Sprintf("/titles/%d/episodes", s.title), ""))

	found := false
	for _, e := range d.Items {
		c := e.Cells.Standard
		if e.Season != 1 || c == nil || c.LastSearch == nil {
			continue
		}
		found = true
		if e.Number == 1 && (c.LastSearch.Releases != 1 || c.LastSearch.Outcome != "grabbed") {
			t.Errorf("S01E01 last_search = %+v, want grabbed over 1 release", c.LastSearch)
		}
	}
	if !found {
		t.Error("no episode cell has a last_search after a search")
	}
}

func TestAWantedSlotInTheListTellsItsLastSearchAndNextSearch(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.publish(t, "Paddington.2014.GERMAN.1080p.BluRay.x264-GRP")
	s.pass(t, jobs.Search)

	list := decode[struct {
		Items []struct {
			SlotStates []struct {
				Slot         string          `json:"slot"`
				State        string          `json:"state"`
				LastSearch   *lastSearchJSON `json:"last_search"`
				NextSearchAt *time.Time      `json:"next_search_at"`
			} `json:"slot_states"`
		} `json:"items"`
	}](t, s.valid("GET", "/titles", ""))

	sl := &list.Items[0].SlotStates[0]
	if sl.Slot != "standard" || sl.State != "wanted" || sl.LastSearch == nil || sl.LastSearch.Releases != 1 || sl.NextSearchAt == nil {
		t.Errorf("Standard slot = %+v, want a Wanted one with its last search and next search", sl)
	}
}
