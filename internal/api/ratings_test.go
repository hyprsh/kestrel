package api_test

import (
	"fmt"
	"testing"

	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
)

type ratingJSON struct {
	Source string   `json:"source"`
	Value  *float64 `json:"value"`
	Scale  *float64 `json:"scale"`
	Votes  *int     `json:"votes"`
	URL    *string  `json:"url"`
}

type ratedJSON struct {
	Ratings []ratingJSON `json:"ratings"`
}

// wantTMDB checks a ratings list is exactly TMDB's audience rating.
func wantTMDB(t *testing.T, what string, got []ratingJSON, value float64, votes int, url string) {
	t.Helper()
	if len(got) != 1 {
		t.Fatalf("%s ratings = %+v, want TMDB's audience rating only", what, got)
	}
	r := got[0]
	if r.Source != "tmdb" || r.Value == nil || *r.Value != value || r.Scale == nil || *r.Scale != 10 ||
		r.Votes == nil || *r.Votes != votes || r.URL == nil || *r.URL != url {
		t.Errorf("%s rating = %s", what, describeRating(r))
	}
}

func describeRating(r ratingJSON) string {
	deref := func(p any) any {
		switch v := p.(type) {
		case *float64:
			if v != nil {
				return *v
			}
		case *int:
			if v != nil {
				return *v
			}
		case *string:
			if v != nil {
				return *v
			}
		}
		return nil
	}
	return fmt.Sprintf("{source:%s value:%v scale:%v votes:%v url:%v}", r.Source, deref(r.Value), deref(r.Scale), deref(r.Votes), deref(r.URL))
}

func TestATitleCarriesTMDBsScoreLinkingToTheTitleOnTMDB(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)

	movie := decode[titleJSON](t, l.valid("POST", "/titles", addPaddington))
	got := decode[ratedJSON](t, l.valid("GET", fmt.Sprintf("/titles/%d", movie.ID), ""))
	wantTMDB(t, "Paddington", got.Ratings, 7.3, 4912, "https://www.themoviedb.org/movie/116149")

	series := decode[titleJSON](t, l.valid("POST", "/titles", addBreakingBad+`}`))
	got = decode[ratedJSON](t, l.valid("GET", fmt.Sprintf("/titles/%d", series.ID), ""))
	wantTMDB(t, "Breaking Bad", got.Ratings, 8.9, 14523, "https://www.themoviedb.org/tv/1396")
}

func TestTheScoreIsStoredWithTheTitleAndMovesOnlyOnARefresh(t *testing.T) {
	t.Parallel()
	l, meta := newRefreshInstance(t)
	created := decode[titleJSON](t, l.valid("POST", "/titles", addPaddington))
	path := fmt.Sprintf("/titles/%d", created.ID)
	meta.rescored.Store(true)

	wantTMDB(t, "before the refresh", decode[ratedJSON](t, l.valid("GET", path, "")).Ratings, 7.3, 4912, "https://www.themoviedb.org/movie/116149")

	l.valid("POST", path+"/refresh", "")
	eventually(t, "the refresh to bring the new rating", func() bool {
		r := decode[ratedJSON](t, l.valid("GET", path, "")).Ratings
		return len(r) == 1 && r[0].Votes != nil && *r[0].Votes == 5000
	})
	wantTMDB(t, "after the refresh", decode[ratedJSON](t, l.valid("GET", path, "")).Ratings, 7.5, 5000, "https://www.themoviedb.org/movie/116149")
}

type ratedHitsJSON struct {
	Items []struct {
		TMDBID  int          `json:"tmdb_id"`
		Ratings []ratingJSON `json:"ratings"`
	} `json:"items"`
}

func TestAddTitleSearchResultsAndTheAddPanelCarryTMDBsScore(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)

	hits := decode[ratedHitsJSON](t, l.valid("GET", "/lookup?q=paddington", ""))
	if len(hits.Items) != 2 {
		t.Fatalf("lookup = %+v", hits.Items)
	}
	wantTMDB(t, "the Paddington hit", hits.Items[0].Ratings, 7.3, 4912, "https://www.themoviedb.org/movie/116149")
	wantTMDB(t, "the Paddington Bear hit", hits.Items[1].Ratings, 6.9, 31, "https://www.themoviedb.org/tv/61814")

	for _, it := range decode[ratedHitsJSON](t, l.valid("GET", "/lookup?q=breaking", "")).Items {
		if it.TMDBID == 1396 {
			wantTMDB(t, "the Breaking Bad hit", it.Ratings, 8.9, 14523, "https://www.themoviedb.org/tv/1396")
		} else if len(it.Ratings) != 0 {
			t.Errorf("unvoted hit %d ratings = %+v, want none", it.TMDBID, it.Ratings)
		}
	}

	wantTMDB(t, "the Paddington panel", decode[ratedJSON](t, l.valid("GET", "/lookup/movie/116149", "")).Ratings, 7.3, 4912, "https://www.themoviedb.org/movie/116149")
	wantTMDB(t, "the Breaking Bad panel", decode[ratedJSON](t, l.valid("GET", "/lookup/series/1396", "")).Ratings, 8.9, 14523, "https://www.themoviedb.org/tv/1396")
	if r := decode[ratedJSON](t, l.valid("GET", "/lookup/movie/77", "")).Ratings; len(r) != 0 {
		t.Errorf("an unvoted panel's ratings = %+v, want none", r)
	}
}
