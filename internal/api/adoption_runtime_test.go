package api_test

import (
	"strings"
	"testing"
)

// movieLookups counts the Movie detail requests the fake TMDB has answered.
func (a adopting) movieLookups() int {
	n := 0
	for _, r := range a.tmdb.Requests() {
		if strings.HasPrefix(r, "/3/movie/9000") {
			n++
		}
	}
	return n
}

// The fake search for "Hamlet" answers four Hamlets in this order, none with a year in the folder
// name: 1996 (242 minutes), 1990 (135), 2000 (112) and 2009 (180). Only their runtimes tell them apart.
func TestARuntimeThatFitsTheFileDecidesWhichOfTwoEqualTitlesIsSuggested(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct {
		folder string
		want   int
	}{
		{"Hamlet 135/hamlet.135min.mkv", 90002},
		{"Hamlet 112/hamlet.112min.mkv", 90003},
	} {
		a := newAdopting(t)
		a.put(t, tt.folder, "x")
		a.scan(t)

		row := a.rowOf(t, strings.Split(tt.folder, "/")[0])

		if row.Status != "needs_choice" || len(row.Candidates) == 0 {
			t.Fatalf("%s = %+v", tt.folder, row)
		}
		if top := row.Candidates[0]; top.TMDBID != tt.want || !top.Suggested || top.Confident {
			t.Errorf("%s: first candidate = %+v, want %d suggested, not confident (no year)", tt.folder, top, tt.want)
		}
	}
}

func TestOnlyTheTopFewCandidatesCostAMetadataLookupForTheirRuntime(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	a.put(t, "Hamlet 135/hamlet.135min.mkv", "x")

	a.scan(t)

	if n := a.movieLookups(); n < 1 || n > 3 {
		t.Errorf("%d runtime lookups for 4 candidates, want a few (at most 3)", n)
	}
}
