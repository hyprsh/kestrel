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

func TestLookupFallsBackToTheQueryWithoutItsTrailingYearAndRanksByIt(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	if got := tmdbIDs(lookup(t, l, "Dune 1984")); len(got) != 4 || got[0] != 841 || got[1] != 438631 {
		t.Errorf("dune 1984 = %v, want the 1984 Dune first", got)
	}
	if got := tmdbIDs(lookup(t, l, "dune (2021)")); len(got) != 4 || got[0] != 438631 {
		t.Errorf("dune (2021) = %v, want the 2021 Dune first", got)
	}
	// TMDB finds nothing for either as typed; the one retry drops the year.
	if got, want := l.searchesSent(t), []string{"Dune 1984", "dune", "dune (2021)", "dune"}; !slices.Equal(got, want) {
		t.Errorf("TMDB was asked %q, want %q", got, want)
	}
}

func TestLookupSearchesAYearThatIsPartOfTheTitle(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	if got := tmdbIDs(lookup(t, l, "Blade Runner 2049")); !slices.Equal(got, []int{335984, 78}) {
		t.Errorf("blade runner 2049 = %v, want Blade Runner 2049 first", got)
	}
	if got := l.searchesSent(t); !slices.Equal(got, []string{"Blade Runner 2049"}) {
		t.Errorf("TMDB was asked %q, want the query as typed, once", got)
	}
	// A year that is not part of the title only ranks.
	if got := tmdbIDs(lookup(t, l, "blade runner 1982")); !slices.Equal(got, []int{78, 335984}) {
		t.Errorf("blade runner 1982 = %v, want the 1982 Blade Runner first", got)
	}
}

func TestLookupNamesTheBestResultWhenItDiffersALotFromTheQuery(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	didYouMean := func(q string) *string {
		return decode[struct {
			DidYouMean *string `json:"did_you_mean"`
		}](t, l.valid("GET", "/lookup?q="+url.QueryEscape(q), "")).DidYouMean
	}
	if got := didYouMean("jurrasic prak"); got == nil || *got != "Jurassic Park" {
		t.Errorf("jurrasic prak: did you mean %v, want Jurassic Park", got)
	}
	for _, q := range []string{"jurassic park", "Jurassic", "paddington", "dune 2021", "padington", "casablanca"} {
		if got := didYouMean(q); got != nil {
			t.Errorf("%s: did you mean %q, want none", q, *got)
		}
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
