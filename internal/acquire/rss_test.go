package acquire_test

import (
	"context"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	"github.com/hyprsh/kestrel/internal/resolution"
)

func day(y int, m time.Month, d int) *time.Time {
	t := time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	return &t
}

// nightShow has two aired episodes in season 1 and one that has yet to air in season 2.
func nightShow() (metadata.SeriesDetails, metadata.TVDBSeries) {
	d := metadata.SeriesDetails{
		TMDBID: 7001, TVDBID: 5001, IMDbID: "tt7001", Title: "Night Show", OriginalTitle: "Night Show", OriginalLanguage: "en", Year: 2024,
		Translations: []metadata.Translation{{Language: "de", Country: "DE", Title: "Nachtshow"}},
	}
	v := metadata.TVDBSeries{ID: 5001, Name: "Night Show", Aliases: []string{"The Night Show"}, Episodes: []metadata.Episode{
		{ID: 1, Season: 1, Number: 1, Name: "Dusk", Aired: day(2026, 1, 5)},
		{ID: 2, Season: 1, Number: 2, Name: "Midnight", Aired: day(2026, 1, 12)},
		{ID: 3, Season: 2, Number: 1, Name: "Dawn", Aired: day(2099, 1, 1)},
	}}
	return d, v
}

func dailyShow() (metadata.SeriesDetails, metadata.TVDBSeries) {
	d := metadata.SeriesDetails{TMDBID: 7002, TVDBID: 5002, Title: "Daily Talk", OriginalTitle: "Daily Talk", OriginalLanguage: "en", Year: 2020}
	v := metadata.TVDBSeries{ID: 5002, Name: "Daily Talk", Episodes: []metadata.Episode{
		{ID: 11, Season: 2026, Number: 1, Name: "Mon", Aired: day(2026, 10, 15)},
		{ID: 12, Season: 2026, Number: 2, Name: "Tue", Aired: day(2026, 10, 16)},
	}}
	return d, v
}

func (r *rig) addSeries(t *testing.T, d metadata.SeriesDetails, v metadata.TVDBSeries, mode library.Monitor) int64 {
	t.Helper()
	id, err := r.lib.AddSeries(context.Background(), library.AddSeries{
		TMDB: d, TVDB: v, PrimaryLanguage: "en", Monitor: mode,
		Versions: []library.VersionSpec{{Slot: resolution.HD, Profile: "hd-primary"}}, RootFolder: "/data/media/tv",
	})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func (r *rig) publishTV(t *testing.T, name string) {
	t.Helper()
	err := r.idx.Publish(indexer.Release{Title: name, Size: 2 << 30, PublishDate: r.clock.now.Add(-time.Hour), Categories: []int{5040}}, []byte("<nzb>"+name+"</nzb>"))
	if err != nil {
		t.Fatal(err)
	}
}

// publishPlain posts a Movie release without any external id, as an RSS feed often does.
func (r *rig) publishPlain(t *testing.T, name string) {
	t.Helper()
	err := r.idx.Publish(indexer.Release{Title: name, Size: 8 << 30, PublishDate: r.clock.now.Add(-time.Hour), Categories: []int{2040}}, []byte("<nzb>"+name+"</nzb>"))
	if err != nil {
		t.Fatal(err)
	}
}

func TestAnRSSItemForAMonitoredMovieIsGrabbedAndARerunOfTheSameFeedIsANoOp(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.publishPlain(t, hd1080)

	out, err := r.svc.SyncRSS(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Grabbed) != 1 || out.Grabbed[0].ReleaseName != hd1080 || out.Grabbed[0].VersionID != r.versions[resolution.HD] {
		t.Fatalf("grabbed = %+v", out.Grabbed)
	}

	out, err = r.svc.SyncRSS(ctx)
	if err != nil || len(out.Grabbed) != 0 {
		t.Errorf("second pass: %+v, %v", out, err)
	}
	if items, _ := r.sab.List(ctx, r.sab.Conn(0), "films"); len(items) != 1 {
		t.Errorf("client holds %d jobs, want 1", len(items))
	}
}

func TestRSSMatchesAMovieWithinAYearAndByAliasAndPrimaryLanguageTitle(t *testing.T) {
	for _, tc := range []struct {
		name    string
		grabbed bool
	}{
		{"Paddington.2015.1080p.BluRay.x264-GRP", true},
		{"Paddington.2013.1080p.BluRay.x264-GRP", true},
		{"Paddington.2016.1080p.BluRay.x264-GRP", false},
		{"Paddington.2012.1080p.BluRay.x264-GRP", false},
		{"Ein.Baer.namens.Paddington.2014.1080p.BluRay.x264-GRP", true},
		{"Other.Movie.2014.1080p.BluRay.x264-GRP", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := newRig(t)
			r.publishPlain(t, tc.name)
			out, err := r.svc.SyncRSS(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			if got := len(out.Grabbed) == 1; got != tc.grabbed {
				t.Errorf("grabbed = %v, want %v (%+v)", got, tc.grabbed, out.Grabbed)
			}
		})
	}
}

func TestRSSDoesNotGrabAReleaseForAnotherSlotOrOneTheProfileRejects(t *testing.T) {
	r := newRig(t)
	r.publishPlain(t, uhd)
	r.publishPlain(t, german)
	out, err := r.svc.SyncRSS(context.Background())
	if err != nil || len(out.Grabbed) != 0 {
		t.Errorf("out = %+v, %v", out, err)
	}
}

func TestRSSGrabsASingleEpisodeOfAMonitoredSeriesButNotAnUnmonitoredOne(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	d, v := nightShow()
	id := r.addSeries(t, d, v, library.MonitorNone)
	eps, _ := r.lib.Episodes(ctx, id, library.View{Country: "US", Now: r.clock.now})
	if err := r.lib.SetEpisodesMonitored(ctx, id, []int64{eps[0].ID}, true); err != nil {
		t.Fatal(err)
	}
	r.publishTV(t, "Night.Show.S01E01.1080p.WEB-DL.H264-GRP")
	r.publishTV(t, "Night.Show.S01E02.1080p.WEB-DL.H264-GRP")

	out, err := r.svc.SyncRSS(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Grabbed) != 1 || out.Grabbed[0].ReleaseName != "Night.Show.S01E01.1080p.WEB-DL.H264-GRP" || out.Grabbed[0].TitleID != id {
		t.Fatalf("grabbed = %+v", out.Grabbed)
	}
	out, _ = r.svc.SyncRSS(ctx)
	if len(out.Grabbed) != 0 {
		t.Errorf("rerun grabbed %+v", out.Grabbed)
	}
	if items, _ := r.sab.List(ctx, r.sab.Conn(0), ""); len(items) != 1 {
		t.Errorf("client holds %d jobs", len(items))
	}
}

func TestRSSMayGrabAnEpisodeThatHasNotAiredYet(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	d, v := nightShow()
	r.addSeries(t, d, v, library.MonitorAll)
	r.publishTV(t, "Night.Show.S02E01.1080p.WEB-DL.H264-GRP")

	out, err := r.svc.SyncRSS(ctx)
	if err != nil || len(out.Grabbed) != 1 {
		t.Errorf("out = %+v, %v", out, err)
	}
}

func TestRSSResolvesADailyReleaseByItsAirDateToTheEpisode(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	d, v := dailyShow()
	id := r.addSeries(t, d, v, library.MonitorAll)
	r.publishTV(t, "Daily.Talk.2026.10.16.1080p.WEB-DL.H264-GRP")

	out, err := r.svc.SyncRSS(ctx)
	if err != nil || len(out.Grabbed) != 1 || out.Grabbed[0].TitleID != id {
		t.Fatalf("out = %+v, %v", out, err)
	}
	out, _ = r.svc.SyncRSS(ctx)
	if len(out.Grabbed) != 0 {
		t.Errorf("rerun grabbed %+v", out.Grabbed)
	}
}

func TestRSSGrabsAFinishedSeasonAsOnePack(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	d, v := nightShow()
	r.addSeries(t, d, v, library.MonitorAll)
	r.publishTV(t, "Night.Show.S01.1080p.WEB-DL.H264-GRP")

	out, err := r.svc.SyncRSS(ctx)
	if err != nil || len(out.Grabbed) != 1 {
		t.Errorf("out = %+v, %v", out, err)
	}
}

func TestRSSReplacesAMisfitMovieFileWithAnyFittingRelease(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	if _, err := r.lib.ReplaceFile(ctx, r.titleID, "Paddington (2014)", library.NewFile{
		VersionID: r.versions[resolution.HD], Path: "/m/Paddington.mkv", Size: 1, ReleaseName: "Paddington.2014.720p", Score: 1000000,
	}); err != nil {
		t.Fatal(err)
	}
	files, _ := r.lib.FilesOfVersion(ctx, r.versions[resolution.HD])
	if err := r.lib.ApplyRescore(ctx, []library.Rescored{{FileID: files[0].ID, Score: 1000000, Misfit: true}}); err != nil {
		t.Fatal(err)
	}
	r.publishPlain(t, hd1080)

	out, err := r.svc.SyncRSS(ctx)

	if err != nil || len(out.Grabbed) != 1 || out.Grabbed[0].ReleaseName != hd1080 {
		t.Fatalf("out = %+v, %v; a fitting Release always replaces a misfit file", out, err)
	}
}

func TestRSSReplacesAMisfitEpisodeFileWithAnyFittingRelease(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	d, v := nightShow()
	id := r.addSeries(t, d, v, library.MonitorAll)
	det, _ := r.lib.Get(ctx, id, library.View{Country: "US", Now: r.clock.now})
	eps, _ := r.lib.Episodes(ctx, id, library.View{Country: "US", Now: r.clock.now})
	if _, err := r.lib.ReplaceEpisodeFile(ctx, id, "Night Show (2024)", library.NewFile{
		VersionID: det.Versions[0].ID, Path: "/tv/s01e01.mkv", Size: 1, ReleaseName: "old", Score: 1000000, Misfit: true,
	}, []int64{eps[0].ID}); err != nil {
		t.Fatal(err)
	}
	r.publishTV(t, "Night.Show.S01E01.1080p.WEB-DL.H264-GRP")

	out, err := r.svc.SyncRSS(ctx)

	if err != nil || len(out.Grabbed) != 1 {
		t.Fatalf("out = %+v, %v; a fitting Release always replaces a misfit file", out, err)
	}
}
