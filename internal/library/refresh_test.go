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
