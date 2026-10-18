package api_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
)

type seriesLookupJSON struct {
	Items []struct {
		Kind          string  `json:"kind"`
		TMDBID        int     `json:"tmdb_id"`
		TVDBID        *int    `json:"tvdb_id"`
		Title         string  `json:"title"`
		Addable       bool    `json:"addable"`
		NotAddableWhy *string `json:"not_addable_reason"`
		InLibrary     *int64  `json:"in_library"`
		Poster        *string `json:"poster"`
		Year          *int    `json:"year"`
	} `json:"items"`
}

type seriesTitleJSON struct {
	ID            int64   `json:"id"`
	Kind          string  `json:"kind"`
	TVDBID        *int    `json:"tvdb_id"`
	Title         string  `json:"title"`
	PrimaryTitle  string  `json:"primary_title"`
	SeriesMonitor *string `json:"series_monitor"`
	Certification *string `json:"certification"`
	Seasons       []struct {
		Number    int  `json:"number"`
		Monitored bool `json:"monitored"`
	} `json:"seasons"`
	Versions []struct {
		Slot  string `json:"slot"`
		State string `json:"state"`
	} `json:"versions"`
}

type cellJSON struct {
	State string `json:"state"`
	Score *int   `json:"score"`
}

type episodeJSON struct {
	ID        int64   `json:"id"`
	Season    int     `json:"season"`
	Number    int     `json:"number"`
	Name      string  `json:"name"`
	AirDate   *string `json:"air_date"`
	Monitored bool    `json:"monitored"`
	Cells     struct {
		Standard *cellJSON `json:"standard"`
		FourK    *cellJSON `json:"4k"`
	} `json:"cells"`
}

const addBreakingBad = `{"kind":"series","tmdb_id":1396,"versions":[{"slot":"standard","profile":"hd-primary"}]`

func episodesOf(t *testing.T, l library, id int64) []episodeJSON {
	t.Helper()
	return decode[struct {
		Items []episodeJSON `json:"items"`
	}](t, l.valid("GET", fmt.Sprintf("/titles/%d/episodes", id), "")).Items
}

func monitoredNames(eps []episodeJSON) map[string]bool {
	out := map[string]bool{}
	for _, e := range eps {
		out[e.Name] = e.Monitored
	}
	return out
}

func TestASeriesIsAddedAgainstTMDBAndTVDBFixturesAndReadBack(t *testing.T) {
	l := newLibraryInstance(t, metadatatest.Key)
	r := l.valid("POST", "/titles", addBreakingBad+`,"series_monitor":"future"}`)
	if r.Status != 201 {
		t.Fatalf("POST /titles = %d %s", r.Status, r.Body)
	}
	created := decode[seriesTitleJSON](t, r)

	got := decode[seriesTitleJSON](t, l.valid("GET", fmt.Sprintf("/titles/%d", created.ID), ""))
	if got.Kind != "series" || got.Title != "Breaking Bad" || got.TVDBID == nil || *got.TVDBID != 81189 || got.SeriesMonitor == nil || *got.SeriesMonitor != "future" {
		t.Errorf("title = %+v", got)
	}
	if got.Certification == nil || *got.Certification != "TV-MA" {
		t.Errorf("certification = %v", got.Certification)
	}
	if len(got.Seasons) != 4 || got.Seasons[0].Number != 0 || got.Seasons[0].Monitored || got.Seasons[1].Monitored || !got.Seasons[2].Monitored || !got.Seasons[3].Monitored {
		t.Errorf("seasons = %+v", got.Seasons)
	}
	if len(got.Versions) != 1 || got.Versions[0].Slot != "standard" || got.Versions[0].State != "unreleased" {
		t.Errorf("versions = %+v", got.Versions)
	}

	eps := episodesOf(t, l, created.ID)
	if len(eps) != 8 {
		t.Fatalf("%d episodes, want every one of both TheTVDB pages", len(eps))
	}
	pilot := eps[1]
	if pilot.Season != 1 || pilot.Number != 1 || pilot.Name != "Pilot" || pilot.AirDate == nil || *pilot.AirDate != "2008-01-20" || pilot.Monitored {
		t.Errorf("pilot = %+v", pilot)
	}
	if pilot.Cells.Standard == nil || pilot.Cells.Standard.State != "unmonitored" || pilot.Cells.FourK != nil {
		t.Errorf("pilot cells = %+v", pilot.Cells)
	}
	undated := eps[6]
	if undated.Name != "Bit by a Dead Bee" || undated.AirDate != nil || !undated.Monitored || undated.Cells.Standard.State != "unreleased" {
		t.Errorf("undated = %+v", undated)
	}
	if eps[7].Cells.Standard.State != "unreleased" || !eps[7].Monitored {
		t.Errorf("future episode = %+v", eps[7])
	}

	// The search finds it in the Library, and its row carries the Series' Slot dots.
	rows := decode[struct {
		Items []rowJSON `json:"items"`
	}](t, l.valid("GET", "/titles?kind=series", "")).Items
	if len(rows) != 1 || rows[0].Slots.Standard == nil || rows[0].Slots.Standard.State != "unreleased" {
		t.Errorf("rows = %+v", rows)
	}
}

func TestEachMonitoringModeThroughTheAPIMonitorsWhatSettledTenSays(t *testing.T) {
	cases := map[string]map[string]bool{
		"all":    {"Good Cop Bad Cop": false, "Pilot": true, "Seven Thirty-Seven": true, "Bit by a Dead Bee": true, "Green Light": true},
		"future": {"Good Cop Bad Cop": false, "Pilot": false, "Seven Thirty-Seven": false, "Bit by a Dead Bee": true, "Green Light": true},
		"none":   {"Good Cop Bad Cop": false, "Pilot": false, "Seven Thirty-Seven": false, "Bit by a Dead Bee": false, "Green Light": false},
	}
	for mode, want := range cases {
		t.Run(mode, func(t *testing.T) {
			l := newLibraryInstance(t, metadatatest.Key)
			id := decode[seriesTitleJSON](t, l.valid("POST", "/titles", addBreakingBad+`,"series_monitor":"`+mode+`"}`)).ID
			got := monitoredNames(episodesOf(t, l, id))
			for name, w := range want {
				if got[name] != w {
					t.Errorf("%s monitored = %v, want %v", name, got[name], w)
				}
			}
		})
	}
}

func TestASeriesIsMonitoredAllWhenNoModeIsGiven(t *testing.T) {
	l := newLibraryInstance(t, metadatatest.Key)
	got := decode[seriesTitleJSON](t, l.valid("POST", "/titles", addBreakingBad+`}`))
	if got.SeriesMonitor == nil || *got.SeriesMonitor != "all" || got.Versions[0].State != "wanted" {
		t.Errorf("title = %+v", got)
	}
}

func TestLookupOffersSeriesAndGreysOutThoseNotOnTheTVDB(t *testing.T) {
	l := newLibraryInstance(t, metadatatest.Key)
	got := decode[seriesLookupJSON](t, l.valid("GET", "/lookup?q=breaking&kind=series", ""))
	if len(got.Items) != 3 {
		t.Fatalf("items = %+v", got.Items)
	}
	bb, bridge, orphan := got.Items[0], got.Items[1], got.Items[2]
	if bb.Title != "Breaking Bad" || !bb.Addable || bb.TVDBID == nil || *bb.TVDBID != 81189 || bb.NotAddableWhy != nil {
		t.Errorf("Breaking Bad = %+v", bb)
	}
	if !bridge.Addable || bridge.TVDBID == nil || *bridge.TVDBID != 300001 {
		t.Errorf("Bridge Show is found through its IMDb id: %+v", bridge)
	}
	if orphan.Addable || orphan.TVDBID != nil || orphan.NotAddableWhy == nil || *orphan.NotAddableWhy != "not_on_tvdb" {
		t.Errorf("Orphan Show = %+v", orphan)
	}
	l.valid("POST", "/titles", addBreakingBad+`}`)
	got = decode[seriesLookupJSON](t, l.valid("GET", "/lookup?q=breaking", ""))
	if got.Items[0].InLibrary == nil {
		t.Errorf("Breaking Bad should be marked in the library: %+v", got.Items[0])
	}
}

func TestASeriesWithoutATVDBMatchIsRefused(t *testing.T) {
	l := newLibraryInstance(t, metadatatest.Key)
	r := l.do("POST", "/titles", `{"kind":"series","tmdb_id":9001,"versions":[{"slot":"standard","profile":"hd-primary"}]}`)
	if r.Status != 422 || !strings.Contains(r.Body, `"field":"tmdb_id"`) || !strings.Contains(r.Body, `"code":"not_on_tvdb"`) {
		t.Errorf("add = %d %s", r.Status, r.Body)
	}
	if list := decode[struct{ Items []rowJSON }](t, l.valid("GET", "/titles", "")); len(list.Items) != 0 {
		t.Errorf("the refused add left %d titles", len(list.Items))
	}
}

func TestASeriesTheTVDBOnlyKnowsByIMDbIDIsAddedThroughTheBridge(t *testing.T) {
	l := newLibraryInstance(t, metadatatest.Key)
	r := l.valid("POST", "/titles", `{"kind":"series","tmdb_id":7001,"versions":[{"slot":"standard","profile":"hd-primary"}]}`)
	if r.Status != 201 {
		t.Fatalf("add = %d %s", r.Status, r.Body)
	}
	got := decode[seriesTitleJSON](t, r)
	if got.TVDBID == nil || *got.TVDBID != 300001 {
		t.Errorf("tvdb id = %v", got.TVDBID)
	}
}

func TestAddingTheSameSeriesTwiceIsAConflict(t *testing.T) {
	l := newLibraryInstance(t, metadatatest.Key)
	id := decode[seriesTitleJSON](t, l.valid("POST", "/titles", addBreakingBad+`}`)).ID
	r := l.do("POST", "/titles", addBreakingBad+`}`)
	if r.Status != 409 || !strings.Contains(r.Body, fmt.Sprint(id)) {
		t.Errorf("second add = %d %s", r.Status, r.Body)
	}
}

func TestASeriesSuggestionPreselectsFromTheSeriesDefaults(t *testing.T) {
	l := newLibraryInstance(t, metadatatest.Key)
	sug := decode[suggestionJSON](t, l.valid("GET", "/lookup/series/1396", ""))
	if sug.Title != "Breaking Bad" || len(sug.Slots) != 1 || sug.Slots[0].Slot != "standard" || sug.Slots[0].Profile != "hd-primary" {
		t.Errorf("suggestion = %+v", sug)
	}
	if sug.Certification == nil || *sug.Certification != "TV-MA" {
		t.Errorf("certification = %v", sug.Certification)
	}
	child := decode[suggestionJSON](t, l.valid("GET", "/lookup/series/7001", ""))
	if len(child.Slots) != 1 || child.Slots[0].Profile != "hd-primary" || child.Slots[0].Reason != "default" {
		t.Errorf("TV-Y7 gets the HD default like any other Title: %+v", child)
	}
}

func TestSeasonAndEpisodeToggles(t *testing.T) {
	l := newLibraryInstance(t, metadatatest.Key)
	id := decode[seriesTitleJSON](t, l.valid("POST", "/titles", addBreakingBad+`,"series_monitor":"none"}`)).ID
	path := func(p string) string { return fmt.Sprintf("/titles/%d%s", id, p) }

	if r := l.do("PATCH", path("/seasons/1"), `{"monitored":true}`); r.Status != 204 {
		t.Fatalf("PATCH season = %d %s", r.Status, r.Body)
	}
	got := monitoredNames(episodesOf(t, l, id))
	if !got["Pilot"] || !got["Cat's in the Bag..."] || got["Seven Thirty-Seven"] {
		t.Errorf("after season 1: %v", got)
	}
	eps := episodesOf(t, l, id)
	if r := l.do("POST", path("/episodes/monitor"), fmt.Sprintf(`{"episode_ids":[%d,%d],"monitored":true}`, eps[4].ID, eps[5].ID)); r.Status != 204 {
		t.Fatalf("monitor = %d %s", r.Status, r.Body)
	}
	got = monitoredNames(episodesOf(t, l, id))
	if !got["Seven Thirty-Seven"] || !got["Grilled"] {
		t.Errorf("after episodes: %v", got)
	}
	title := decode[seriesTitleJSON](t, l.valid("GET", path(""), ""))
	if !title.Seasons[2].Monitored {
		t.Errorf("season 2 follows its episodes: %+v", title.Seasons)
	}
	if r := l.do("POST", path("/episodes/monitor"), `{"episode_ids":[999999],"monitored":true}`); r.Status != 404 {
		t.Errorf("a foreign episode = %d %s", r.Status, r.Body)
	}
	if r := l.do("PATCH", path("/seasons/9"), `{"monitored":true}`); r.Status != 404 {
		t.Errorf("an unknown season = %d %s", r.Status, r.Body)
	}

	r := l.do("PATCH", path(""), `{"series_monitor":"all"}`)
	if r.Status != 200 {
		t.Fatalf("PATCH title = %d %s", r.Status, r.Body)
	}
	if got := monitoredNames(episodesOf(t, l, id)); got["Good Cop Bad Cop"] || !got["Green Light"] || !got["Pilot"] {
		t.Errorf("after switching to all: %v", got)
	}
	if r := l.do("PATCH", path(""), `{"series_monitor":"sometimes"}`); r.Status != 422 && r.Status != 400 {
		t.Errorf("a bad mode = %d %s", r.Status, r.Body)
	}
}

func TestMoviesHaveNoEpisodesOrModes(t *testing.T) {
	l := newLibraryInstance(t, metadatatest.Key)
	id := decode[titleJSON](t, l.valid("POST", "/titles", addPaddington)).ID
	if r := l.do("GET", fmt.Sprintf("/titles/%d/episodes", id), ""); r.Status != 404 {
		t.Errorf("episodes of a Movie = %d %s", r.Status, r.Body)
	}
	if r := l.do("PATCH", fmt.Sprintf("/titles/%d", id), `{"series_monitor":"all"}`); r.Status != 422 {
		t.Errorf("mode of a Movie = %d %s", r.Status, r.Body)
	}
	got := decode[seriesTitleJSON](t, l.valid("GET", fmt.Sprintf("/titles/%d", id), ""))
	if got.SeriesMonitor != nil || len(got.Seasons) != 0 {
		t.Errorf("a Movie shows no Series fields: %+v", got)
	}
}
