package library_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/resolution"
)

func aired(y int, m time.Month, d int) *time.Time {
	t := day(y, m, d)
	return &t
}

// show: a special, two aired episodes of season 1, an aired and an undated one of
// season 2 and one episode of season 3 that has yet to air (now is 2026-10-17).
func show() (metadata.SeriesDetails, metadata.TVDBSeries) {
	d := metadata.SeriesDetails{
		TMDBID: 1396, TVDBID: 81189, IMDbID: "tt0903747", Title: "Breaking Bad", OriginalTitle: "Breaking Bad", OriginalLanguage: "en",
		Year: 2008, Runtime: 47, Overview: "A teacher turns to crime.", PosterPath: "/p.jpg",
		Ratings:      metadata.ReleaseDates{{Country: "US", Type: metadata.TV, Date: day(2008, 1, 20), Certification: "TV-MA"}},
		Aliases:      []metadata.Alias{{Country: "DE", Title: "Breaking Bad - Total verhext"}},
		Translations: []metadata.Translation{{Language: "de", Country: "DE", Title: "Breaking Bad Deutsch"}},
	}
	v := metadata.TVDBSeries{ID: 81189, Name: "Breaking Bad", Aliases: []string{"BB"}, Episodes: []metadata.Episode{
		{ID: 1, Season: 0, Number: 1, Name: "Special", Aired: aired(2009, 2, 17)},
		{ID: 2, Season: 1, Number: 1, Name: "Pilot", Aired: aired(2008, 1, 20)},
		{ID: 3, Season: 1, Number: 2, Name: "Cat", Aired: aired(2008, 1, 27)},
		{ID: 4, Season: 2, Number: 1, Name: "Seven", Aired: aired(2009, 3, 8)},
		{ID: 5, Season: 2, Number: 2, Name: "Undated"},
		{ID: 6, Season: 3, Number: 1, Name: "Future", Aired: aired(2099, 1, 1)},
	}}
	return d, v
}

func addShow(t *testing.T, lib *library.Service, mode library.Monitor, versions ...library.VersionSpec) int64 {
	t.Helper()
	if len(versions) == 0 {
		versions = []library.VersionSpec{{Slot: resolution.HD, Profile: "hd-primary"}}
	}
	d, v := show()
	id, err := lib.AddSeries(context.Background(), library.AddSeries{
		TMDB: d, TVDB: v, PrimaryLanguage: "de", Monitor: mode, Versions: versions, RootFolder: "/data/media/tv",
	})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func monitoredByEpisode(t *testing.T, lib *library.Service, id int64) map[string]bool {
	t.Helper()
	eps, err := lib.Episodes(context.Background(), id, library.View{Country: "US", Now: now})
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]bool{}
	for _, e := range eps {
		out[e.Name] = e.Monitored
	}
	return out
}

func TestASeriesIsAddedWithSeasonsAndEpisodesAndReadBack(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	id := addShow(t, lib, library.MonitorAll)

	d, err := lib.Get(ctx, id, library.View{Country: "US", Now: now})
	if err != nil {
		t.Fatal(err)
	}
	if d.Kind != library.Series || d.TMDBID != 1396 || d.TVDBID != 81189 || d.IMDbID != "tt0903747" || d.Title != "Breaking Bad" ||
		d.PrimaryTitle != "Breaking Bad Deutsch" || d.Year != 2008 || d.Runtime != 47 || d.RootFolder != "/data/media/tv" || d.SeriesMonitor != library.MonitorAll {
		t.Errorf("detail = %+v", d)
	}
	if len(d.Aliases) != 3 {
		t.Errorf("aliases = %+v, want the alternative title, the translation and TheTVDB's alias", d.Aliases)
	}
	if _, cert := d.ReleaseDates.Certification("US"); cert != "TV-MA" {
		t.Errorf("certification = %q", cert)
	}
	var seasons []int
	for _, s := range d.Seasons {
		seasons = append(seasons, s.Number)
	}
	if len(seasons) != 4 || seasons[0] != 0 || seasons[3] != 3 {
		t.Errorf("seasons = %+v", d.Seasons)
	}
	eps, err := lib.Episodes(ctx, id, library.View{Country: "US", Now: now})
	if err != nil {
		t.Fatal(err)
	}
	if len(eps) != 6 || eps[1].Season != 1 || eps[1].Number != 1 || eps[1].Name != "Pilot" || eps[1].AirDate == nil || !eps[1].AirDate.Equal(day(2008, 1, 20)) || eps[4].AirDate != nil {
		t.Errorf("episodes = %+v", eps)
	}
	if got := eps[1].Cells[resolution.HD]; got == nil || got.State != library.Wanted {
		t.Errorf("aired monitored episode, HD cell = %+v", got)
	}
	if eps[1].Cells[resolution.SD] != nil || eps[1].Cells[resolution.UHD] != nil {
		t.Errorf("only the Slots that have a Version have cells: %+v", eps[1].Cells)
	}
	if got := eps[5].Cells[resolution.HD]; got.State != library.Unreleased {
		t.Errorf("a future episode is unreleased, got %+v", got)
	}
	if got := eps[0].Cells[resolution.HD]; got.State != library.Unmonitored {
		t.Errorf("a special is not monitored, got %+v", got)
	}
	if len(d.Versions) != 1 || d.Versions[0].State != library.Wanted || d.Versions[0].WantedSince == nil {
		t.Errorf("versions = %+v", d.Versions)
	}
}

func TestEachMonitoringModeMonitorsExactlyWhatSettledTenSays(t *testing.T) {
	cases := []struct {
		mode library.Monitor
		want map[string]bool
	}{
		{library.MonitorAll, map[string]bool{"Special": false, "Pilot": true, "Cat": true, "Seven": true, "Undated": true, "Future": true}},
		{library.MonitorFuture, map[string]bool{"Special": false, "Pilot": false, "Cat": false, "Seven": false, "Undated": true, "Future": true}},
		{library.MonitorNone, map[string]bool{"Special": false, "Pilot": false, "Cat": false, "Seven": false, "Undated": false, "Future": false}},
	}
	for _, c := range cases {
		t.Run(string(c.mode), func(t *testing.T) {
			lib, _ := newLibrary(t)
			id := addShow(t, lib, c.mode)
			got := monitoredByEpisode(t, lib, id)
			for name, want := range c.want {
				if got[name] != want {
					t.Errorf("%s monitored = %v, want %v", name, got[name], want)
				}
			}
		})
	}
}

func TestSeasonsAreMonitoredWhenTheyHaveAMonitoredEpisode(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	id := addShow(t, lib, library.MonitorFuture)
	d, _ := lib.Get(ctx, id, library.View{Country: "US", Now: now})
	got := map[int]bool{}
	for _, s := range d.Seasons {
		got[s.Number] = s.Monitored
	}
	if got[0] || got[1] || !got[2] || !got[3] {
		t.Errorf("season monitoring = %v", got)
	}
}

func TestMonitoringASeasonAndEpisodesByHand(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	id := addShow(t, lib, library.MonitorNone)
	view := library.View{Country: "US", Now: now}

	if err := lib.SetSeasonMonitored(ctx, id, 1, true); err != nil {
		t.Fatal(err)
	}
	got := monitoredByEpisode(t, lib, id)
	if !got["Pilot"] || !got["Cat"] || got["Seven"] {
		t.Errorf("after monitoring season 1: %v", got)
	}

	eps, _ := lib.Episodes(ctx, id, view)
	if err := lib.SetEpisodesMonitored(ctx, id, []int64{eps[1].ID}, false); err != nil {
		t.Fatal(err)
	}
	got = monitoredByEpisode(t, lib, id)
	if got["Pilot"] || !got["Cat"] {
		t.Errorf("after unmonitoring the pilot: %v", got)
	}
	d, _ := lib.Get(ctx, id, view)
	if !d.Seasons[1].Monitored {
		t.Errorf("season 1 still has a monitored episode: %+v", d.Seasons)
	}

	if err := lib.SetEpisodesMonitored(ctx, id, []int64{eps[2].ID}, false); err != nil {
		t.Fatal(err)
	}
	d, _ = lib.Get(ctx, id, view)
	if d.Seasons[1].Monitored {
		t.Errorf("season 1 has none left: %+v", d.Seasons)
	}

	// An episode of another Title is not this Title's to toggle.
	other := addPaddington(t, lib)
	if err := lib.SetEpisodesMonitored(ctx, other, []int64{eps[1].ID}, true); !errors.Is(err, library.ErrNotFound) && !errors.Is(err, library.ErrNotASeries) {
		t.Errorf("err = %v", err)
	}
	if err := lib.SetSeasonMonitored(ctx, id, 9, true); !errors.Is(err, library.ErrNotFound) {
		t.Errorf("an unknown season: %v", err)
	}
}

func TestChangingTheModeReappliesItAndKeepsSpecialsOut(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	id := addShow(t, lib, library.MonitorNone)
	if err := lib.SetSeriesMonitor(ctx, id, library.MonitorAll); err != nil {
		t.Fatal(err)
	}
	got := monitoredByEpisode(t, lib, id)
	if got["Special"] || !got["Pilot"] || !got["Future"] {
		t.Errorf("all: %v", got)
	}
	d, _ := lib.Get(ctx, id, library.View{Country: "US", Now: now})
	if d.SeriesMonitor != library.MonitorAll {
		t.Errorf("mode = %s", d.SeriesMonitor)
	}
	if err := lib.SetSeriesMonitor(ctx, addPaddington(t, lib), library.MonitorAll); !errors.Is(err, library.ErrNotASeries) {
		t.Errorf("a Movie has no monitoring mode: %v", err)
	}
}

func TestASeriesAlreadyInTheLibraryIsRefused(t *testing.T) {
	lib, _ := newLibrary(t)
	id := addShow(t, lib, library.MonitorAll)
	d, v := show()
	_, err := lib.AddSeries(context.Background(), library.AddSeries{
		TMDB: d, TVDB: v, Monitor: library.MonitorAll, Versions: []library.VersionSpec{{Slot: resolution.HD, Profile: "hd-primary"}}, RootFolder: "/x",
	})
	var exists *library.ExistsError
	if !errors.As(err, &exists) || exists.ID != id {
		t.Errorf("err = %v", err)
	}
}

func TestSeriesSlotsShowInTheListWithTheirState(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	addShow(t, lib, library.MonitorAll, library.VersionSpec{Slot: resolution.HD, Profile: "hd-primary"}, library.VersionSpec{Slot: resolution.UHD, Profile: "uhd-primary"})
	rows, err := lib.List(ctx, library.View{Country: "US", Now: now}, library.Filter{Kind: library.Series})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].Kind != library.Series || rows[0].Slots[resolution.HD].State != library.Wanted || rows[0].Slots[resolution.UHD] == nil || rows[0].WantedSince == nil {
		t.Fatalf("rows = %+v", rows)
	}
	// Monitoring nothing leaves nothing to want.
	lib2, _ := newLibrary(t)
	addShow(t, lib2, library.MonitorNone)
	rows, _ = lib2.List(ctx, library.View{Country: "US", Now: now}, library.Filter{})
	if got := rows[0].Slots[resolution.HD].State; got != library.Unmonitored {
		t.Errorf("state = %s", got)
	}
}

func TestSeriesVersionsHaveSearchStateOncePerSeasonButNotForSpecials(t *testing.T) {
	lib, st := newLibrary(t)
	addShow(t, lib, library.MonitorAll)
	rows, err := st.Read().QueryContext(context.Background(), `SELECT season FROM search_state ORDER BY season`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var seasons []int
	for rows.Next() {
		var s int
		if err := rows.Scan(&s); err != nil {
			t.Fatal(err)
		}
		seasons = append(seasons, s)
	}
	if len(seasons) != 3 || seasons[0] != 1 || seasons[2] != 3 {
		t.Errorf("search_state seasons = %v, want 1, 2, 3 (never Specials)", seasons)
	}
}
