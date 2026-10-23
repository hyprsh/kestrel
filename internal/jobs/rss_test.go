package jobs_test

import (
	"context"
	"github.com/hyprsh/kestrel/internal/slot"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/downloads"
	"github.com/hyprsh/kestrel/internal/indexers"
	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/plugin"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
	dcfake "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1/fake"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	ixfake "github.com/hyprsh/kestrel/internal/plugin/indexer/v1/fake"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
	"github.com/hyprsh/kestrel/internal/settings"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/store/storetest"
)

func aired(y int, m time.Month, d int) *time.Time {
	t := time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	return &t
}

func TestTheRSSLoopGrabsAMatchingReleaseSkipsAnUnmonitoredTitleAndIsANoOpWhenRerun(t *testing.T) {
	ctx := context.Background()
	st, err := store.Open(ctx, store.Options{Dir: storetest.Dir(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })

	ix, sab := ixfake.New("k"), dcfake.New("k")
	reg := plugin.NewRegistry()
	if err := reg.Register(indexer.Contract, ix); err != nil {
		t.Fatal(err)
	}
	if err := reg.Register(downloadclient.Contract, sab); err != nil {
		t.Fatal(err)
	}
	inst := instances.NewService(st, reg)
	for _, n := range []instances.New{
		{PluginID: ixfake.ID, Name: "Alpha", Priority: 1, Config: map[string]any{"api_key": "k"}},
		{PluginID: dcfake.ID, Name: "SAB", Config: map[string]any{"api_key": "k", "movie_category": "films"}},
	} {
		if _, err := inst.Create(ctx, n); err != nil {
			t.Fatal(err)
		}
	}

	lib := library.New(st, func() time.Time { return now })
	hd := []library.VersionSpec{{Slot: slot.Standard, Profile: "hd-primary"}}
	if _, err := lib.AddMovie(ctx, library.AddMovie{
		Details:         metadata.MovieDetails{TMDBID: 1, Title: "Paddington", OriginalTitle: "Paddington", OriginalLanguage: "en", Year: 2014},
		PrimaryLanguage: "en", Versions: hd, RootFolder: "/m",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := lib.AddSeries(ctx, library.AddSeries{
		TMDB:            metadata.SeriesDetails{TMDBID: 2, TVDBID: 20, Title: "Night Show", OriginalTitle: "Night Show", OriginalLanguage: "en", Year: 2024},
		TVDB:            metadata.TVDBSeries{ID: 20, Name: "Night Show", Episodes: []metadata.Episode{{ID: 1, Season: 1, Number: 1, Name: "Dusk", Aired: aired(2026, 1, 5)}}},
		PrimaryLanguage: "en", Monitor: library.MonitorNone, Versions: hd, RootFolder: "/t",
	}); err != nil {
		t.Fatal(err)
	}

	acq, err := acquire.New(acquire.Deps{
		Store: st, Clock: func() time.Time { return now }, Library: lib, Profiles: profiles.New(st, settings.New(st)),
		Indexers: indexers.New(inst, st, func() time.Time { return now }), Downloads: downloads.New(inst),
	})
	if err != nil {
		t.Fatal(err)
	}
	r := jobs.Standard(jobs.Deps{Acquire: acq, Library: lib, Clock: func() time.Time { return now }})

	for name, cat := range map[string]int{
		"Paddington.2014.1080p.BluRay.x264-GRP":   2040,
		"Night.Show.S01E01.1080p.WEB-DL.H264-GRP": 5040,
	} {
		err := ix.Publish(indexer.Release{Title: name, Size: 4 << 30, PublishDate: now.Add(-time.Hour), Categories: []int{cat}}, []byte("<nzb/>"))
		if err != nil {
			t.Fatal(err)
		}
	}

	for pass := 1; pass <= 2; pass++ {
		if err := r.Pass(ctx, jobs.RSS); err != nil {
			t.Fatal(err)
		}
		movies, _ := sab.List(ctx, sab.Conn(0), "films")
		all, _ := sab.List(ctx, sab.Conn(0), "")
		if len(movies) != 1 || movies[0].Name != "Paddington.2014.1080p.BluRay.x264-GRP" {
			t.Errorf("pass %d: Movie jobs = %+v, want the matching Release once", pass, movies)
		}
		if len(all) != 1 {
			t.Errorf("pass %d: the client holds %+v, want nothing for the unmonitored episode", pass, all)
		}
	}
}
