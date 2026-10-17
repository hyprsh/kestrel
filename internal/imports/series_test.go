package imports_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/imports"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/probe"
	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/resolution"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
	"github.com/hyprsh/kestrel/internal/settings"
	"github.com/hyprsh/kestrel/internal/store"
)

const (
	packName   = "Night.Show.S01.1080p.WEB-DL.H264-GRP"
	seriesRoot = "Night Show (2024) {tvdb-5001}"
)

var seriesNow = time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)

type seriesRig struct {
	*rig
	titleID int64
	version int64
	eps     []library.Episode
}

// newSeriesRig is Night Show: three aired episodes in season 1, one in season 2, all monitored.
func newSeriesRig(t *testing.T) *seriesRig {
	t.Helper()
	ctx := context.Background()
	st, err := store.Open(ctx, store.Options{Dir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	r := &rig{prober: &fakeProber{info: map[string]probe.Info{}}, root: t.TempDir(), downs: t.TempDir(), versions: map[resolution.Class]int64{}}
	r.lib = library.New(st, func() time.Time { return seriesNow })
	aired := func(m time.Month, d int) *time.Time { x := time.Date(2026, m, d, 0, 0, 0, 0, time.UTC); return &x }
	id, err := r.lib.AddSeries(ctx, library.AddSeries{
		TMDB: metadata.SeriesDetails{TMDBID: 7001, TVDBID: 5001, Title: "Night Show", OriginalTitle: "Night Show", OriginalLanguage: "en", Year: 2024, Runtime: 45},
		TVDB: metadata.TVDBSeries{ID: 5001, Name: "Night Show", Episodes: []metadata.Episode{
			{ID: 1, Season: 1, Number: 1, Name: "Dusk", Aired: aired(1, 5)},
			{ID: 2, Season: 1, Number: 2, Name: "Midnight", Aired: aired(1, 12)},
			{ID: 3, Season: 1, Number: 3, Name: "Dawn", Aired: aired(1, 19)},
			{ID: 4, Season: 2, Number: 1, Name: "Noon", Aired: aired(2, 1)},
		}},
		PrimaryLanguage: "en", Monitor: library.MonitorAll, RootFolder: r.root,
		Versions: []library.VersionSpec{{Slot: resolution.HD, Profile: "hd-primary"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	svc, err := imports.New(imports.Deps{
		Library: r.lib, Profiles: profiles.New(st, settings.New(st)), Prober: r.prober, Clock: func() time.Time { return seriesNow },
		Step: func(step string) error {
			if r.hook != nil {
				return r.hook(step)
			}
			return nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	r.svc = svc
	d, _ := r.lib.Get(ctx, id, library.View{Country: "US", Now: seriesNow})
	s := &seriesRig{rig: r, titleID: id, version: d.Versions[0].ID}
	s.eps, _ = r.lib.Episodes(ctx, id, library.View{Country: "US", Now: seriesNow})
	return s
}

func (s *seriesRig) episodes(t *testing.T) []library.Episode {
	t.Helper()
	eps, err := s.lib.Episodes(context.Background(), s.titleID, library.View{Country: "US", Now: seriesNow})
	if err != nil {
		t.Fatal(err)
	}
	return eps
}

// download writes a finished job and returns the Grab for it.
func (s *seriesRig) download(t *testing.T, name string, id int64, files []string) imports.Grab {
	t.Helper()
	dir := filepath.Join(s.downs, name)
	for _, f := range files {
		p := filepath.Join(dir, f)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("video "+f), 0o644); err != nil {
			t.Fatal(err)
		}
		info := good()
		info.Duration = 44 * time.Minute
		s.prober.info[filepath.Base(f)] = info
	}
	parsed, err := release.Parse(name, release.KindSeries)
	if err != nil {
		t.Fatal(err)
	}
	pj, _ := json.Marshal(parsed)
	return imports.Grab{ID: id, TitleID: s.titleID, VersionID: s.version, ReleaseName: name, Parsed: pj, SourcePath: dir, CanRemove: true}
}

func resultOf(t *testing.T, res imports.Result, season, number int) imports.EpisodeResult {
	t.Helper()
	for _, e := range res.Episodes {
		if e.Season == season && e.Number == number {
			return e
		}
	}
	t.Fatalf("no result for S%02dE%02d in %+v", season, number, res.Episodes)
	return imports.EpisodeResult{}
}

func TestASingleEpisodeIsImportedIntoItsSeasonFolderAndFillsTheHeatMap(t *testing.T) {
	s := newSeriesRig(t)
	g := s.download(t, "Night.Show.S01E01.1080p.WEB-DL.H264-GRP", 1, []string{"night.show.s01e01.1080p.mkv", "readme.nfo"})

	res := s.svc.Import(context.Background(), g)

	if res.Status != imports.Imported {
		t.Fatalf("result = %+v", res)
	}
	dir := filepath.Join(s.root, seriesRoot, "Season 01")
	if filepath.Dir(res.Path) != dir || !strings.HasPrefix(filepath.Base(res.Path), "Night Show (2024) - S01E01 - [HD]") {
		t.Errorf("path = %q", res.Path)
	}
	if b, err := os.ReadFile(res.Path); err != nil || string(b) != "video night.show.s01e01.1080p.mkv" {
		t.Errorf("file = %q, %v", b, err)
	}
	eps := s.episodes(t)
	if eps[0].Cells[resolution.HD].State != library.Filled || eps[1].Cells[resolution.HD].State == library.Filled {
		t.Errorf("cells = %+v / %+v", eps[0].Cells[resolution.HD], eps[1].Cells[resolution.HD])
	}
	if e := resultOf(t, res, 1, 1); e.Status != imports.Imported || e.Path != res.Path {
		t.Errorf("episode result = %+v", e)
	}
}

func TestASeasonPackImportsOnlyMonitoredEpisodesThatAreMissingOrBeatenAndReportsEachOne(t *testing.T) {
	ctx := context.Background()
	s := newSeriesRig(t)
	// Episode 2 already has a better file; episode 3 is not monitored.
	if _, err := s.lib.ReplaceEpisodeFile(ctx, s.titleID, seriesRoot, library.NewFile{VersionID: s.version, Path: filepath.Join(s.root, "held.mkv"), Size: 1, ReleaseName: "old", Score: 100000}, []int64{s.eps[1].ID}); err != nil {
		t.Fatal(err)
	}
	if err := s.lib.SetEpisodesMonitored(ctx, s.titleID, []int64{s.eps[2].ID}, false); err != nil {
		t.Fatal(err)
	}
	g := s.download(t, packName, 2, []string{
		"Night.Show.S01E01.1080p.WEB-DL.H264-GRP.mkv", "Night.Show.S01E02.1080p.WEB-DL.H264-GRP.mkv", "Night.Show.S01E03.1080p.WEB-DL.H264-GRP.mkv",
		"Sample/sample.mkv",
	})

	res := s.svc.Import(ctx, g)

	if res.Status != imports.Imported || len(res.Episodes) != 3 {
		t.Fatalf("result = %+v", res)
	}
	if e := resultOf(t, res, 1, 1); e.Status != imports.Imported {
		t.Errorf("E01 = %+v", e)
	}
	if e := resultOf(t, res, 1, 2); e.Status != imports.Rejected || e.Reason != imports.ReasonNotUpgrade {
		t.Errorf("E02 = %+v", e)
	}
	if e := resultOf(t, res, 1, 3); e.Status != imports.Rejected || e.Reason != imports.ReasonUnmonitored {
		t.Errorf("E03 = %+v", e)
	}
	got, _ := os.ReadDir(filepath.Join(s.root, seriesRoot, "Season 01"))
	if len(got) != 1 {
		t.Errorf("season folder holds %d files, want only episode 1", len(got))
	}
}

func TestAPackWhoseEpisodesAreAllHeldOrUnmonitoredIsRejectedAsNoUpgrade(t *testing.T) {
	ctx := context.Background()
	s := newSeriesRig(t)
	if err := s.lib.SetEpisodesMonitored(ctx, s.titleID, []int64{s.eps[0].ID, s.eps[1].ID, s.eps[2].ID}, false); err != nil {
		t.Fatal(err)
	}
	g := s.download(t, packName, 3, []string{"Night.Show.S01E01.1080p.WEB-DL.H264-GRP.mkv"})

	res := s.svc.Import(ctx, g)

	if res.Status != imports.Rejected || res.Reason != imports.ReasonNotUpgrade {
		t.Errorf("result = %+v", res)
	}
}

func TestADoubleEpisodeFileHoldsBothEpisodesUnderOneRangeName(t *testing.T) {
	s := newSeriesRig(t)
	g := s.download(t, "Night.Show.S01E01-E02.1080p.WEB-DL.H264-GRP", 4, []string{"show.mkv"})

	res := s.svc.Import(context.Background(), g)

	if res.Status != imports.Imported || !strings.Contains(filepath.Base(res.Path), "S01E01-E02") {
		t.Fatalf("result = %+v", res)
	}
	eps := s.episodes(t)
	if eps[0].Cells[resolution.HD].State != library.Filled || eps[1].Cells[resolution.HD].State != library.Filled {
		t.Error("both episodes should be filled")
	}
}

func TestADailyEpisodeIsMatchedByItsAirDate(t *testing.T) {
	s := newSeriesRig(t)
	g := s.download(t, "Night.Show.2026.01.12.1080p.WEB-DL.H264-GRP", 5, []string{"x.mkv"})

	res := s.svc.Import(context.Background(), g)

	if res.Status != imports.Imported || !strings.Contains(filepath.Base(res.Path), "S01E02") {
		t.Fatalf("result = %+v", res)
	}
}

func TestAnEpisodeThatBeatsTheHeldFileReplacesItOnDisk(t *testing.T) {
	ctx := context.Background()
	s := newSeriesRig(t)
	dir := filepath.Join(s.root, seriesRoot, "Season 01")
	old := filepath.Join(dir, "old.mkv")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(old, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := s.lib.ReplaceEpisodeFile(ctx, s.titleID, seriesRoot, library.NewFile{VersionID: s.version, Path: old, Size: 3, ReleaseName: "old", Score: -5000}, []int64{s.eps[0].ID}); err != nil {
		t.Fatal(err)
	}
	g := s.download(t, "Night.Show.S01E01.1080p.WEB-DL.H264-GRP", 7, []string{"x.mkv"})

	res := s.svc.Import(ctx, g)

	if res.Status != imports.Imported {
		t.Fatalf("result = %+v", res)
	}
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Error("the replaced file is still on disk")
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 1 {
		t.Errorf("season folder holds %d files", len(entries))
	}
}

func TestACrashAfterTheRowWasWrittenIsFinishedByTheRerun(t *testing.T) {
	ctx := context.Background()
	s := newSeriesRig(t)
	g := s.download(t, "Night.Show.S01E01.1080p.WEB-DL.H264-GRP", 8, []string{"x.mkv"})
	s.hook = func(step string) error {
		if step == "committed" {
			return errors.New("killed")
		}
		return nil
	}
	if res := s.svc.Import(ctx, g); res.Status != imports.Stalled {
		t.Fatalf("first run = %+v", res)
	}
	s.hook = nil

	res := s.svc.Import(ctx, g)

	if res.Status != imports.Imported {
		t.Fatalf("rerun = %+v", res)
	}
	if b, err := os.ReadFile(res.Path); err != nil || string(b) != "video x.mkv" {
		t.Errorf("file = %q, %v", b, err)
	}
}
