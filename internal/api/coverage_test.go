package api_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/jobs"
)

type coverageJSON struct {
	Episodes    int   `json:"episodes"`
	Filled      int   `json:"filled"`
	Wanted      int   `json:"wanted"`
	LongMissing int   `json:"long_missing"`
	Size        int64 `json:"size"`
}

// versionCoverage is the first Version's state and coverage.
func versionCoverage(t *testing.T, s search) (string, *coverageJSON) {
	t.Helper()
	r := s.valid("GET", fmt.Sprintf("/titles/%d", s.title), "")
	if r.Status != 200 {
		t.Fatalf("GET /titles/%d = %d %s", s.title, r.Status, r.Body)
	}
	d := decode[struct {
		Versions []struct {
			State    string        `json:"state"`
			Coverage *coverageJSON `json:"coverage"`
		} `json:"versions"`
	}](t, r)
	if len(d.Versions) == 0 {
		t.Fatal("no Versions")
	}
	return d.Versions[0].State, d.Versions[0].Coverage
}

func TestASeriesVersionCoverageCountsTheEpisodesItHoldsAndWantsAndTheirSize(t *testing.T) {
	t.Parallel()
	s := newSeriesSearch(t)

	// Monitored and aired: S01E01-E03, S02E01-E02. The Special is unmonitored, S02E03 and S03E01 are still to come.
	state, c := versionCoverage(t, s.search)
	if state != "wanted" || c == nil || *c != (coverageJSON{Episodes: 5, Filled: 0, Wanted: 5}) {
		t.Fatalf("before any Import: state %s, coverage %+v", state, c)
	}

	s.prober.set(goodProbe(), nil)
	s.publishEpisode(t, badEp1, "1", "1")
	s.pass(t, jobs.Search)
	s.finish(t, badEp1, "breaking.bad.s01e01.mkv")
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)

	state, c = versionCoverage(t, s.search)
	want := coverageJSON{Episodes: 5, Filled: 1, Wanted: 4, Size: goodProbe().Size}
	if state != "wanted" || c == nil || *c != want {
		t.Fatalf("after one Import: state %s, coverage %+v, want %+v", state, c, want)
	}

	for range 5 { // 100 days, in steps the session outlives
		s.in.clock.Advance(20 * 24 * time.Hour)
		_, c = versionCoverage(t, s.search)
	}
	if want.LongMissing = 4; c == nil || *c != want {
		t.Fatalf("100 days later: coverage %+v, want %+v", c, want)
	}
}

func TestAMovieVersionHasNoSeriesCoverage(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	if _, c := versionCoverage(t, s); c != nil {
		t.Fatalf("coverage = %+v, want none for a Movie", c)
	}
}
