package library_test

import (
	"context"
	"github.com/hyprsh/kestrel/internal/slot"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
)

func TestRefreshingAMovieUpdatesItsMetadataAndSaysWhenItsNameChanged(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	id := addPaddington(t, lib)

	d := paddington()
	d.Overview = "A bear in London, updated."
	d.Aliases = []metadata.Alias{{Country: "DE", Title: "Paddington der Bär"}}
	res, err := lib.RefreshMovie(ctx, id, library.MovieRefresh{Details: d, PrimaryLanguage: "de"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Renamed {
		t.Error("an overview change must not rename")
	}
	got, _ := lib.Get(ctx, id, library.View{Country: "DE", Now: now})
	if got.Overview != "A bear in London, updated." || len(got.Aliases) != 2 || got.Aliases[0].Title != "Paddington der Bär" {
		t.Errorf("detail = %+v", got)
	}

	d.Title, d.Year = "Paddington Bear", 2015
	res, err = lib.RefreshMovie(ctx, id, library.MovieRefresh{Details: d, PrimaryLanguage: "de"})
	if err != nil || !res.Renamed {
		t.Fatalf("res = %+v, err = %v", res, err)
	}
	got, _ = lib.Get(ctx, id, library.View{Country: "DE", Now: now})
	if got.Title != "Paddington Bear" || got.Year != 2015 {
		t.Errorf("detail = %+v", got)
	}
}

func TestAFrozenTitleIsNotRefreshable(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	id := addPaddington(t, lib)
	refs, _ := lib.Refreshable(ctx)
	if len(refs) != 1 || refs[0].ID != id || refs[0].TMDBID != 116149 || !refs[0].RefreshedAt.Equal(now) {
		t.Fatalf("refs = %+v", refs)
	}
	if err := lib.SetMetadataFrozen(ctx, id, true); err != nil {
		t.Fatal(err)
	}
	if refs, _ = lib.Refreshable(ctx); len(refs) != 0 {
		t.Errorf("refs = %+v", refs)
	}
	got, _ := lib.Get(ctx, id, library.View{Country: "DE", Now: now})
	if !got.MetadataFrozen {
		t.Error("not frozen")
	}
	if err := lib.SetMetadataFrozen(ctx, 999, true); err != library.ErrNotFound {
		t.Errorf("err = %v", err)
	}
}

func TestRefreshingASeriesUpdatesEpisodesAndAddsNewOnes(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	aired := func(m time.Month, d int) *time.Time { x := time.Date(2026, m, d, 0, 0, 0, 0, time.UTC); return &x }
	tmdb := metadata.SeriesDetails{TMDBID: 7001, TVDBID: 5001, Title: "Night Show", OriginalTitle: "Night Show", OriginalLanguage: "en", Year: 2024}
	id, err := lib.AddSeries(ctx, library.AddSeries{
		TMDB: tmdb,
		TVDB: metadata.TVDBSeries{ID: 5001, Episodes: []metadata.Episode{
			{ID: 1, Season: 1, Number: 1, Name: "Dusk", Aired: aired(1, 5)},
			{ID: 2, Season: 1, Number: 2, Name: "Midnight", Aired: aired(1, 12)},
		}},
		PrimaryLanguage: "en", Monitor: library.MonitorAll, RootFolder: "/data/media/tv",
		Versions: []library.VersionSpec{{Slot: slot.Standard, Profile: "hd-primary"}},
	})
	if err != nil {
		t.Fatal(err)
	}

	res, err := lib.RefreshSeries(ctx, id, library.SeriesRefresh{
		TMDB: tmdb,
		TVDB: metadata.TVDBSeries{ID: 5001, Episodes: []metadata.Episode{
			{ID: 1, Season: 1, Number: 1, Name: "Dusk (retitled)", Aired: aired(1, 6)},
			{ID: 2, Season: 1, Number: 2, Name: "Midnight", Aired: aired(1, 12)},
			{ID: 9, Season: 3, Number: 1, Name: "New season", Aired: aired(3, 1)},
		}},
		PrimaryLanguage: "en",
	})
	if err != nil || res.Renamed {
		t.Fatalf("res = %+v, err = %v", res, err)
	}
	eps, _ := lib.Episodes(ctx, id, library.View{Country: "US", Now: now})
	if len(eps) != 3 || eps[0].Name != "Dusk (retitled)" || eps[0].AirDate.Day() != 6 || eps[2].Season != 3 || !eps[2].Monitored {
		t.Errorf("episodes = %+v", eps)
	}
	d, _ := lib.Get(ctx, id, library.View{Country: "US", Now: now})
	if len(d.Seasons) != 2 {
		t.Errorf("seasons = %+v", d.Seasons)
	}
}

func TestARefreshWithoutTranslatedTitlesKeepsTheStoredOnes(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	tmdb := metadata.SeriesDetails{TMDBID: 7001, TVDBID: 5001, Title: "Night Show", OriginalTitle: "Night Show", OriginalLanguage: "en", Year: 2024}
	id, err := lib.AddSeries(ctx, library.AddSeries{
		TMDB: tmdb,
		TVDB: metadata.TVDBSeries{ID: 5001, Episodes: []metadata.Episode{
			{ID: 1, Season: 1, Number: 1, Name: "Dusk", PrimaryName: "Abenddämmerung"},
		}},
		PrimaryLanguage: "de", Monitor: library.MonitorAll, RootFolder: "/data/media/tv",
		Versions: []library.VersionSpec{{Slot: slot.Standard, Profile: "hd-primary"}},
	})
	if err != nil {
		t.Fatal(err)
	}

	// TheTVDB's German titles could not be fetched: no PrimaryName, and a new episode.
	_, err = lib.RefreshSeries(ctx, id, library.SeriesRefresh{
		TMDB: tmdb,
		TVDB: metadata.TVDBSeries{ID: 5001, Episodes: []metadata.Episode{
			{ID: 1, Season: 1, Number: 1, Name: "Dusk"},
			{ID: 2, Season: 1, Number: 2, Name: "Midnight"},
		}},
		PrimaryLanguage: "de",
	})
	if err != nil {
		t.Fatal(err)
	}

	eps, _ := lib.Episodes(ctx, id, library.View{Country: "DE", Now: now})
	if len(eps) != 2 || eps[0].PrimaryName != "Abenddämmerung" || eps[1].PrimaryName != "Midnight" {
		t.Errorf("episodes = %+v, want the stored German title kept and the original standing in for the new one", eps)
	}
}

func TestARefreshLeavesANewSeasonUnmonitoredWhenNewSeasonsIsOff(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	aired := func(m time.Month, d int) *time.Time { x := time.Date(2026, m, d, 0, 0, 0, 0, time.UTC); return &x }
	tmdb := metadata.SeriesDetails{TMDBID: 7002, TVDBID: 5002, Title: "Night Show", OriginalTitle: "Night Show", OriginalLanguage: "en", Year: 2024}
	id, err := lib.AddSeries(ctx, library.AddSeries{
		TMDB:            tmdb,
		TVDB:            metadata.TVDBSeries{ID: 5002, Episodes: []metadata.Episode{{ID: 1, Season: 1, Number: 1, Name: "Dusk", Aired: aired(1, 5)}}},
		PrimaryLanguage: "en", Monitor: library.MonitorAll, RootFolder: "/data/media/tv",
		Versions: []library.VersionSpec{{Slot: slot.Standard, Profile: "hd-primary"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	off, on := false, true
	if err := lib.SetSeriesMonitorOptions(ctx, id, &off, &on); err != nil {
		t.Fatal(err)
	}
	_, err = lib.RefreshSeries(ctx, id, library.SeriesRefresh{
		TMDB: tmdb,
		TVDB: metadata.TVDBSeries{ID: 5002, Episodes: []metadata.Episode{
			{ID: 1, Season: 1, Number: 1, Name: "Dusk", Aired: aired(1, 5)},
			{ID: 2, Season: 1, Number: 2, Name: "Midnight", Aired: aired(1, 12)},
			{ID: 9, Season: 2, Number: 1, Name: "New season", Aired: aired(3, 1)},
			{ID: 10, Season: 0, Number: 1, Name: "Behind", Aired: aired(3, 2)},
		}},
		PrimaryLanguage: "en",
	})
	if err != nil {
		t.Fatal(err)
	}
	got := monitoredByEpisode(t, lib, id)
	if !got["Midnight"] || got["New season"] || got["Behind"] {
		// A new Special is in a new season too: it follows new seasons being off.
		t.Errorf("monitored = %v", got)
	}
}

// #381: a Series in mode none with a monitored season (what a Request leaves) counts as monitored, and a refresh adds the
// new episodes of that season monitored and those of the other seasons unmonitored.
func TestARefreshMonitorsNewEpisodesOfAMonitoredSeasonInAModeNoneSeries(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	aired := func(m time.Month, d int) *time.Time { x := time.Date(2026, m, d, 0, 0, 0, 0, time.UTC); return &x }
	tmdb := metadata.SeriesDetails{TMDBID: 7003, TVDBID: 5003, Title: "Night Show", OriginalTitle: "Night Show", OriginalLanguage: "en", Year: 2024}
	id, err := lib.AddSeries(ctx, library.AddSeries{
		TMDB: tmdb,
		TVDB: metadata.TVDBSeries{ID: 5003, Episodes: []metadata.Episode{
			{ID: 1, Season: 1, Number: 1, Name: "Dusk", Aired: aired(1, 5)},
			{ID: 2, Season: 2, Number: 1, Name: "Dawn", Aired: aired(2, 5)},
		}},
		PrimaryLanguage: "en", Monitor: library.MonitorNone, RootFolder: "/data/media/tv",
		Versions: []library.VersionSpec{{Slot: slot.Standard, Profile: "hd-primary"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	view := library.View{Country: "US", Now: now}
	if d, _ := lib.Get(ctx, id, view); d.Monitored {
		t.Fatal("a mode-none Series with no monitored season is monitored")
	}
	if rows, _ := lib.List(ctx, view, library.Filter{}); len(rows) != 1 || rows[0].Monitored {
		t.Fatalf("rows = %+v", rows)
	}
	if err := lib.SetSeasonMonitored(ctx, id, 1, true); err != nil {
		t.Fatal(err)
	}
	if d, _ := lib.Get(ctx, id, view); !d.Monitored {
		t.Error("detail: a Series with a monitored season is unmonitored")
	}
	if rows, _ := lib.List(ctx, view, library.Filter{}); len(rows) != 1 || !rows[0].Monitored {
		t.Errorf("list: rows = %+v", rows)
	}

	_, err = lib.RefreshSeries(ctx, id, library.SeriesRefresh{
		TMDB: tmdb,
		TVDB: metadata.TVDBSeries{ID: 5003, Episodes: []metadata.Episode{
			{ID: 1, Season: 1, Number: 1, Name: "Dusk", Aired: aired(1, 5)},
			{ID: 3, Season: 1, Number: 2, Name: "Midnight", Aired: aired(1, 12)},
			{ID: 2, Season: 2, Number: 1, Name: "Dawn", Aired: aired(2, 5)},
			{ID: 4, Season: 2, Number: 2, Name: "Sunrise", Aired: aired(2, 12)},
		}},
		PrimaryLanguage: "en",
	})
	if err != nil {
		t.Fatal(err)
	}
	got := monitoredByEpisode(t, lib, id)
	if !got["Midnight"] || got["Sunrise"] || got["Dawn"] {
		t.Errorf("monitored = %v", got)
	}
}

// A Series in mode none with only a monitored episode is monitored: the episode is searched for when it airs.
func TestAModeNoneSeriesWithOnlyAMonitoredEpisodeIsMonitored(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	aired := func(m time.Month, d int) *time.Time { x := time.Date(2026, m, d, 0, 0, 0, 0, time.UTC); return &x }
	id, err := lib.AddSeries(ctx, library.AddSeries{
		TMDB: metadata.SeriesDetails{TMDBID: 7004, TVDBID: 5004, Title: "Late Show", OriginalTitle: "Late Show", OriginalLanguage: "en", Year: 2024},
		TVDB: metadata.TVDBSeries{ID: 5004, Episodes: []metadata.Episode{
			{ID: 1, Season: 1, Number: 1, Name: "Dusk", Aired: aired(1, 5)},
			{ID: 2, Season: 1, Number: 2, Name: "Dawn", Aired: aired(12, 5)},
		}},
		PrimaryLanguage: "en", Monitor: library.MonitorNone, RootFolder: "/data/media/tv",
		Versions: []library.VersionSpec{{Slot: slot.Standard, Profile: "hd-primary"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	view := library.View{Country: "US", Now: now}
	if d, _ := lib.Get(ctx, id, view); d.Monitored {
		t.Fatal("a mode-none Series with nothing monitored is monitored")
	}
	eps, err := lib.Episodes(ctx, id, view)
	if err != nil {
		t.Fatal(err)
	}
	if err := lib.SetEpisodesMonitored(ctx, id, []int64{eps[1].ID}, true); err != nil {
		t.Fatal(err)
	}
	if d, _ := lib.Get(ctx, id, view); !d.Monitored {
		t.Error("detail: a Series with a monitored episode is unmonitored")
	}
	if rows, _ := lib.List(ctx, view, library.Filter{}); len(rows) != 1 || !rows[0].Monitored {
		t.Errorf("list: rows = %+v", rows)
	}
}
