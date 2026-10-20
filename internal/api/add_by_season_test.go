package api_test

import (
	"reflect"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
)

type lookupSeasonJSON struct {
	Number     int     `json:"number"`
	Episodes   int     `json:"episodes"`
	FirstAired *string `json:"first_aired"`
	LastAired  *string `json:"last_aired"`
}

type lookupDetailJSON struct {
	Title    string   `json:"title"`
	Overview string   `json:"overview"`
	Poster   *string  `json:"poster"`
	Runtime  *int     `json:"runtime"`
	Genres   []string `json:"genres"`
}

type lookupSeriesJSON struct {
	Status       *string            `json:"status"`
	Network      *string            `json:"network"`
	FirstAired   *string            `json:"first_aired"`
	LastAired    *string            `json:"last_aired"`
	LatestSeason *int               `json:"latest_season"`
	Seasons      []lookupSeasonJSON `json:"seasons"`
}

func str(s string) *string { return &s }

// askedTheTVDB says whether the fake TheTVDB was asked for the series.
func askedTheTVDB(l library, id string) bool {
	for _, p := range l.tvdb.Requests() {
		if strings.HasPrefix(p, "GET /v4/series/"+id) {
			return true
		}
	}
	return false
}

func TestTheAddPanelDescribesASeriesWithoutWaitingForTheTVDB(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	got := decode[lookupDetailJSON](t, l.valid("GET", "/lookup/series/1396", ""))

	if got.Overview != "A teacher turns to crime." || got.Poster == nil || !strings.HasSuffix(*got.Poster, "/w185/ggFHVNu6YYI5L9pCfOacjizRGt.jpg") {
		t.Errorf("overview/poster = %q %v", got.Overview, got.Poster)
	}
	if got.Runtime == nil || *got.Runtime != 47 || !reflect.DeepEqual(got.Genres, []string{"Drama", "Crime"}) {
		t.Errorf("runtime/genres = %v %v", got.Runtime, got.Genres)
	}
	if askedTheTVDB(l, "81189") {
		t.Errorf("the lookup waited on TheTVDB: %v", l.tvdb.Requests())
	}
}

func TestASeriesOverviewComesFromTheTVDB(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	s := decode[lookupSeriesJSON](t, l.valid("GET", "/lookup/series/1396/overview", ""))

	if s.Status == nil || *s.Status != "ended" || s.Network == nil || *s.Network != "AMC" {
		t.Errorf("status/network = %v %v", s.Status, s.Network)
	}
	// The clock is 2026-10-17: season 3's lone episode is dated 2099, so season 2 is the latest that aired.
	if s.FirstAired == nil || *s.FirstAired != "2008-01-20" || s.LastAired == nil || *s.LastAired != "2009-03-15" {
		t.Errorf("aired = %v .. %v", s.FirstAired, s.LastAired)
	}
	if s.LatestSeason == nil || *s.LatestSeason != 2 {
		t.Errorf("latest season = %v", s.LatestSeason)
	}
	want := []lookupSeasonJSON{
		{0, 1, str("2009-02-17"), str("2009-02-17")},
		{1, 3, str("2008-01-20"), str("2008-02-10")},
		{2, 3, str("2009-03-08"), str("2009-03-15")},
		{3, 1, str("2099-01-01"), str("2099-01-01")},
	}
	if !reflect.DeepEqual(s.Seasons, want) {
		t.Errorf("seasons = %+v", s.Seasons)
	}
	if !askedTheTVDB(l, "81189") {
		t.Errorf("the overview did not ask TheTVDB: %v", l.tvdb.Requests())
	}
}

func TestASeriesTheTVDBLacksHasNoOverview(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	r := l.valid("GET", "/lookup/series/9001/overview", "")
	if r.Status != 404 || !strings.Contains(r.Body, `"code":"not_on_tvdb"`) {
		t.Errorf("overview of a Series TheTVDB lacks = %d %s, want 404 not_on_tvdb", r.Status, r.Body)
	}
	if r := l.valid("GET", "/lookup/series/424242/overview", ""); r.Status != 404 {
		t.Errorf("overview of a Series TMDB lacks = %d %s", r.Status, r.Body)
	}
}

func TestTheTVDBFailingFailsOnlyTheSeriesOverview(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	l.tvdb.Close()

	if r := l.valid("GET", "/lookup/series/1396", ""); r.Status != 200 {
		t.Errorf("lookup with TheTVDB down = %d %s, want the panel's details all the same", r.Status, r.Body)
	}
	if r := l.valid("GET", "/lookup/series/1396/overview", ""); r.Status != 502 {
		t.Errorf("overview with TheTVDB down = %d %s, want 502", r.Status, r.Body)
	}
}

func TestASeriesIsAddedWithOnlyTheSeasonsAsked(t *testing.T) {
	t.Parallel()
	for name, tc := range map[string]struct {
		body    string
		want    []string
		seasons []int
	}{
		"first season, nothing later": {`,"seasons":[1],"series_monitor":"none"}`,
			[]string{"Pilot", "Cat's in the Bag...", "...And the Bag's in the River"}, []int{1}},
		// Season 3 has not started airing, so following new seasons monitors it.
		"latest season, then what is new": {`,"seasons":[2],"series_monitor":"future"}`,
			[]string{"Seven Thirty-Seven", "Grilled", "Bit by a Dead Bee", "Green Light"}, []int{2, 3}},
		"specials when named": {`,"seasons":[0],"series_monitor":"none"}`,
			[]string{"Good Cop Bad Cop"}, []int{0}},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			l := newLibraryInstance(t, metadatatest.Key)
			title := decode[seriesTitleJSON](t, l.valid("POST", "/titles", addBreakingBad+tc.body))
			var got []string
			for _, e := range episodesOf(t, l, title.ID) {
				if e.Monitored {
					got = append(got, e.Name)
				}
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("monitored = %q, want %q", got, tc.want)
			}
			var seasons []int
			for _, se := range title.Seasons {
				if se.Monitored {
					seasons = append(seasons, se.Number)
				}
			}
			if !reflect.DeepEqual(seasons, tc.seasons) {
				t.Errorf("monitored seasons = %v, want %v", seasons, tc.seasons)
			}
		})
	}
}

func TestSeasonsAtAddMustExistAndBelongToASeries(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	for body, field := range map[string]string{
		addBreakingBad + `,"seasons":[9]}`:                         "unknown",
		addBreakingBad + `,"seasons":[-1]}`:                        "invalid",
		strings.TrimSuffix(addPaddington, "}") + `,"seasons":[1]}`: "not_a_series",
	} {
		r := l.valid("POST", "/titles", body)
		if r.Status != 422 || !strings.Contains(r.Body, `"field":"seasons"`) || !strings.Contains(r.Body, `"code":"`+field+`"`) {
			t.Errorf("%s = %d %s", body, r.Status, r.Body)
		}
	}
	if rows := decode[struct {
		Items []rowJSON `json:"items"`
	}](t, l.valid("GET", "/titles", "")); len(rows.Items) != 0 {
		t.Errorf("a refused add left Titles: %+v", rows.Items)
	}
}
