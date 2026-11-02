package api_test

import (
	"slices"
	"testing"

	"github.com/hyprsh/kestrel/internal/jobs"
)

// addOverlapping adds Paddington with a Standard HD Version and a 4K-Slot Any Version, whose Profiles both take a
// 1080p Release.
func (s *search) addOverlapping(t *testing.T) {
	t.Helper()
	r := s.valid("POST", "/titles", `{"kind":"movie","tmdb_id":116149,"versions":[{"slot":"standard","profile":"hd-primary"},{"slot":"4k","profile":"any-primary"}]}`)
	if r.Status != 201 {
		t.Fatalf("POST /titles = %d %s", r.Status, r.Body)
	}
	s.title = decode[titleJSON](t, r).ID
}

func TestOneDownloadFillingTwoVersionsIsOneQueueItemAndOneGrabEntryNamingBothSlots(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	s.addOverlapping(t)
	s.publish(t, goodRelease)

	s.pass(t, jobs.Search)

	q := decode[struct {
		Items []struct {
			Slot  *string  `json:"slot"`
			Slots []string `json:"slots"`
		} `json:"items"`
	}](t, s.valid("GET", "/queue", "")).Items
	if len(q) != 1 || !slices.Equal(q[0].Slots, []string{"standard", "4k"}) || q[0].Slot == nil || *q[0].Slot != "standard" {
		t.Fatalf("queue = %+v, want one download for the Standard Slot that also fills 4k", q)
	}
	if len(s.jobs(t)) != 1 {
		t.Errorf("the client holds %d jobs, want 1", len(s.jobs(t)))
	}

	grabs := decode[struct {
		Items []struct {
			Slots []string `json:"slots"`
		} `json:"items"`
	}](t, s.valid("GET", "/grabs", "")).Items
	if len(grabs) != 1 || !slices.Equal(grabs[0].Slots, []string{"standard", "4k"}) {
		t.Errorf("grabs = %+v, want one entry naming both Slots", grabs)
	}
}

func TestADownloadForOneVersionNamesOnlyItsOwnSlot(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.publish(t, goodRelease)

	s.pass(t, jobs.Search)

	q := decode[struct {
		Items []struct {
			Slots []string `json:"slots"`
		} `json:"items"`
	}](t, s.valid("GET", "/queue", "")).Items
	for _, it := range q {
		if len(it.Slots) != 1 {
			t.Errorf("queue item slots = %v, want just its own", it.Slots)
		}
	}
}
