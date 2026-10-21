package api_test

import (
	"net/url"
	"slices"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
)

// searchesSent lists the queries the add-search sent to TMDB, oldest first.
func (l library) searchesSent(t *testing.T) []string {
	t.Helper()
	var out []string
	for _, r := range l.tmdb.Requests() {
		if !strings.HasPrefix(r, "/3/search/multi?") {
			continue
		}
		u, err := url.Parse(r)
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, u.Query().Get("query"))
	}
	return out
}

type foundJSON struct {
	TMDBID int    `json:"tmdb_id"`
	Title  string `json:"title"`
	Year   *int   `json:"year"`
}

func lookup(t *testing.T, l library, q string) []foundJSON {
	t.Helper()
	got := decode[struct {
		Items []foundJSON `json:"items"`
	}](t, l.valid("GET", "/lookup?q="+url.QueryEscape(q), ""))
	return got.Items
}

func tmdbIDs(found []foundJSON) []int {
	out := make([]int, len(found))
	for i, f := range found {
		out[i] = f.TMDBID
	}
	return out
}

func TestLookupRanksTheTitlesThatMatchTheQueryFirst(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	// TMDB lists Dune: Part Two first; both Movies named just Dune match better, in TMDB's order.
	if got, want := tmdbIDs(lookup(t, l, "dune")), []int{438631, 841, 693134, 1290938}; !slices.Equal(got, want) {
		t.Errorf("dune = %v, want %v", got, want)
	}
}

func TestLookupSearchesWithoutATrailingYearAndRanksByIt(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	if got := tmdbIDs(lookup(t, l, "Dune 1984")); len(got) != 4 || got[0] != 841 || got[1] != 438631 {
		t.Errorf("dune 1984 = %v, want the 1984 Dune first", got)
	}
	if got := tmdbIDs(lookup(t, l, "dune (2021)")); len(got) != 4 || got[0] != 438631 {
		t.Errorf("dune (2021) = %v, want the 2021 Dune first", got)
	}
	if got := l.searchesSent(t); !slices.Equal(got, []string{"Dune", "dune"}) {
		t.Errorf("TMDB was asked %q, want the queries without their years, once each", got)
	}
}

func TestLookupAsksOnceMoreWithAFoldedQueryWhenTMDBFindsNothing(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	if got := lookup(t, l, "Amélie!"); len(got) != 1 || got[0].Title != "Amelie" {
		t.Errorf("amélie = %+v", got)
	}
	if got := lookup(t, l, "Casablanca"); len(got) != 0 {
		t.Errorf("casablanca = %+v", got)
	}
	if got := lookup(t, l, "Casa-Blanca"); len(got) != 0 {
		t.Errorf("casa-blanca = %+v", got)
	}
	// One retry at most, and none when folding changes nothing but case.
	if got, want := l.searchesSent(t), []string{"Amélie!", "amelie", "Casablanca", "Casa-Blanca", "casa blanca"}; !slices.Equal(got, want) {
		t.Errorf("TMDB was asked %q, want %q", got, want)
	}
}
