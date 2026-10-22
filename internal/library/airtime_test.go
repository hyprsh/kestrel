package library_test

import (
	"context"
	"testing"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/slot"
	"github.com/hyprsh/kestrel/internal/store"
)

type airing struct{ network, status, airTime, zone string }

func airingOf(t *testing.T, st *store.Store, id int64) airing {
	t.Helper()
	var a airing
	if err := st.Read().QueryRow(`SELECT network, tvdb_status, air_time, air_timezone FROM titles WHERE id = ?`, id).Scan(&a.network, &a.status, &a.airTime, &a.zone); err != nil {
		t.Fatal(err)
	}
	return a
}

func nightShow(tv metadata.TVDBSeries, network string) library.AddSeries {
	return library.AddSeries{
		TMDB:            metadata.SeriesDetails{TMDBID: 7001, TVDBID: 5001, Title: "Night Show", OriginalTitle: "Night Show", OriginalLanguage: "en", Year: 2024, Network: network},
		TVDB:            tv,
		PrimaryLanguage: "en", Monitor: library.MonitorAll, RootFolder: "/data/media/tv",
		Versions: []library.VersionSpec{{Slot: slot.Standard, Profile: "hd-primary"}},
	}
}

func TestASeriesStoresItsNetworkStatusAirTimeAndEpisodeOverviewsWhenAddedAndRefreshed(t *testing.T) {
	ctx := context.Background()
	lib, st := newLibrary(t)
	tv := metadata.TVDBSeries{ID: 5001, Status: "upcoming", AirsTime: "21:00", AirsTimezone: "America/New_York", Episodes: []metadata.Episode{
		{ID: 1, Season: 1, Number: 1, Name: "Dusk", Overview: "The first night.", Aired: aired(2026, 11, 3)},
	}}
	id, err := lib.AddSeries(ctx, nightShow(tv, "HBO"))
	if err != nil {
		t.Fatal(err)
	}
	if got, want := airingOf(t, st, id), (airing{"HBO", "upcoming", "21:00", "America/New_York"}); got != want {
		t.Errorf("stored = %+v, want %+v", got, want)
	}

	// A refresh brings a new status and network; what the providers could not
	// say this time (no air time) leaves the stored value.
	tv.Status, tv.AirsTime, tv.AirsTimezone = "continuing", "", ""
	tv.Episodes = []metadata.Episode{{ID: 1, Season: 1, Number: 1, Name: "Dusk", Overview: "", Aired: aired(2026, 11, 3)}}
	if _, err := lib.RefreshSeries(ctx, id, library.SeriesRefresh{TMDB: nightShow(tv, "Max").TMDB, TVDB: tv, PrimaryLanguage: "en"}); err != nil {
		t.Fatal(err)
	}
	if got, want := airingOf(t, st, id), (airing{"Max", "continuing", "21:00", "America/New_York"}); got != want {
		t.Errorf("refreshed = %+v, want %+v", got, want)
	}
	var overview string
	if err := st.Read().QueryRow(`SELECT overview FROM episodes WHERE title_id = ?`, id).Scan(&overview); err != nil || overview != "The first night." {
		t.Errorf("episode overview = %q (%v), want the stored one kept when TheTVDB has none now", overview, err)
	}
}

func TestTheNetworkFallsBackToTheTVDBsWhenTMDBHasNone(t *testing.T) {
	lib, st := newLibrary(t)
	id, err := lib.AddSeries(context.Background(), nightShow(metadata.TVDBSeries{ID: 5001, Network: "BBC One"}, ""))
	if err != nil {
		t.Fatal(err)
	}
	if got := airingOf(t, st, id).network; got != "BBC One" {
		t.Errorf("network = %q, want TheTVDB's", got)
	}
}
