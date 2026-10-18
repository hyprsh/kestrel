package jobs_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/health"
	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/imports"
	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
	"github.com/hyprsh/kestrel/internal/probe"
	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/resolution"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
	"github.com/hyprsh/kestrel/internal/settings"
	"github.com/hyprsh/kestrel/internal/store"
)

// editedMeta serves the recorded TMDB fixtures, with edits on top to play the
// provider changing its mind.
type editedMeta struct {
	metadata.Provider
	movie  func(*metadata.MovieDetails)
	series func(*metadata.SeriesDetails)
}

func (e editedMeta) Movie(ctx context.Context, id int) (metadata.MovieDetails, error) {
	d, err := e.Provider.Movie(ctx, id)
	if e.movie != nil && err == nil {
		e.movie(&d)
	}
	return d, err
}

func (e editedMeta) Series(ctx context.Context, id int) (metadata.SeriesDetails, error) {
	d, err := e.Provider.Series(ctx, id)
	if e.series != nil && err == nil {
		e.series(&d)
	}
	return d, err
}

// editedTVDB does the same for TheTVDB.
type editedTVDB struct {
	metadata.TVDBProvider
	edit func(*metadata.TVDBSeries)
}

func (e editedTVDB) Series(ctx context.Context, id int) (metadata.TVDBSeries, error) {
	s, err := e.TVDBProvider.Series(ctx, id)
	if e.edit != nil && err == nil {
		e.edit(&s)
	}
	return s, err
}

type refreshRig struct {
	lib     *library.Service
	imp     *imports.Service
	health  *health.Service
	history *history.Service
	meta    *editedMeta
	tvdb    *editedTVDB
	ref     *jobs.Refresher
	root    string
	clock   time.Time
	changed []string
}

func newRefreshRig(t *testing.T) *refreshRig {
	t.Helper()
	ctx := context.Background()
	st, err := store.Open(ctx, store.Options{Dir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	r := &refreshRig{root: t.TempDir(), clock: now}
	clock := func() time.Time { return r.clock }
	tmdb := metadata.NewTMDB(metadata.TMDBOptions{BaseURL: metadatatest.New(t).APIBase(), Keys: metadata.StaticKey(metadatatest.Key)})
	r.meta = &editedMeta{Provider: tmdb}
	r.tvdb = &editedTVDB{TVDBProvider: metadata.NewTVDB(metadata.TVDBOptions{BaseURL: metadatatest.NewTVDB(t).APIBase(), Keys: metadata.StaticTVDBKey(metadatatest.TVDBKey)})}
	r.lib = library.New(st, clock)
	r.history = history.New(st, clock, nil)
	r.health = health.New(health.Deps{Store: st, Clock: clock})
	prof := profiles.New(st, settings.New(st))
	r.imp, err = imports.New(imports.Deps{
		Library: r.lib, Renames: r.lib, Profiles: prof, Prober: probe.Unavailable{}, Clock: clock,
		FolderChanged: func(_ context.Context, folder string) { r.changed = append(r.changed, folder) },
	})
	if err != nil {
		t.Fatal(err)
	}
	r.ref = jobs.NewRefresher(jobs.RefresherDeps{
		Library: r.lib, Meta: r.meta, TVDB: r.tvdb, Renamer: r.imp, State: settings.New(st),
		Primary: func(context.Context) (string, error) { return "en", nil },
		History: r.history, Health: r.health, Clock: clock,
	})
	return r
}

// holdFile puts a file on disk and in the library as an Import would have.
func (r *refreshRig) holdFile(t *testing.T, titleID, versionID int64, folder, name, releaseName string, kind release.Kind, episodes []int64) {
	t.Helper()
	ctx := context.Background()
	path := filepath.Join(r.root, folder, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("video"), 0o644); err != nil {
		t.Fatal(err)
	}
	parsed, err := release.Parse(releaseName, kind)
	if err != nil {
		t.Fatal(err)
	}
	pj, _ := json.Marshal(parsed)
	info := probe.Info{Size: 1, Duration: time.Hour, HasVideo: true, Width: 1920, Height: 1080, VideoCodec: "h264",
		Audio: []probe.AudioTrack{{Index: 1, Codec: "eac3", Channels: 6, Language: "eng"}}}
	ij, _ := json.Marshal(info)
	nf := library.NewFile{VersionID: versionID, Path: path, Size: 1, ReleaseName: releaseName, ParsedRelease: string(pj), Probe: string(ij), Score: 10}
	if episodes != nil {
		_, err = r.lib.ReplaceEpisodeFile(ctx, titleID, folder, nf, episodes)
	} else {
		_, err = r.lib.ReplaceFile(ctx, titleID, folder, nf)
	}
	if err != nil {
		t.Fatal(err)
	}
}

func (r *refreshRig) addMovie(t *testing.T, tmdbID int) (titleID, versionID int64) {
	t.Helper()
	ctx := context.Background()
	d, err := r.meta.Provider.Movie(ctx, tmdbID)
	if err != nil {
		t.Fatal(err)
	}
	id, err := r.lib.AddMovie(ctx, library.AddMovie{
		Details: d, PrimaryLanguage: "en", RootFolder: r.root,
		Versions: []library.VersionSpec{{Slot: resolution.HD, Profile: "hd-primary"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	det, _ := r.lib.Get(ctx, id, library.View{Country: "US", Now: r.clock})
	return id, det.Versions[0].ID
}

func (r *refreshRig) files(t *testing.T) []string {
	t.Helper()
	var out []string
	_ = filepath.WalkDir(r.root, func(p string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			rel, _ := filepath.Rel(r.root, p)
			out = append(out, rel)
		}
		return nil
	})
	return out
}

const paddingtonRelease = "Paddington.2014.1080p.BluRay.x264-GRP"

func TestAChangedEnglishTitleOrYearRenamesTheFolderAndEveryFileAndIsLogged(t *testing.T) {
	ctx := context.Background()
	r := newRefreshRig(t)
	id, vid := r.addMovie(t, 116149)
	r.holdFile(t, id, vid, "Paddington (2014) {tmdb-116149}", "Paddington (2014) {tmdb-116149} - [HD][Bluray-1080p][EAC3 5.1][h264]-GRP.mkv", paddingtonRelease, release.KindMovie, nil)
	after := r.history.Last
	last, _ := after(ctx)

	r.meta.movie = func(d *metadata.MovieDetails) { d.Title, d.Year = "Paddington Bear", 2015 }
	if err := r.ref.Refresh(ctx, id); err != nil {
		t.Fatal(err)
	}

	files := r.files(t)
	if len(files) != 1 || !strings.HasPrefix(files[0], "Paddington Bear (2015) {tmdb-116149}/Paddington Bear (2015) {tmdb-116149} - [HD]") {
		t.Errorf("files = %v", files)
	}
	d, _ := r.lib.Get(ctx, id, library.View{Country: "US", Now: now})
	if d.Title != "Paddington Bear" || d.Folder != "Paddington Bear (2015) {tmdb-116149}" || d.Versions[0].File.Path != filepath.Join(r.root, files[0]) {
		t.Errorf("detail = %+v", d)
	}
	evs, _ := r.history.After(ctx, last, 10)
	var renames int
	for _, e := range evs {
		if e.Kind == history.Renamed && e.TitleID == id && !e.Routine {
			renames++
		}
	}
	if renames != 1 {
		t.Errorf("events = %+v", evs)
	}
	if len(r.changed) == 0 {
		t.Error("the media-server hook was not told the folder changed")
	}
}

func TestAnEpisodeTitleChangeNeverRenamesButASeriesTitleChangeDoes(t *testing.T) {
	ctx := context.Background()
	r := newRefreshRig(t)
	tmdb, err := r.meta.Provider.Series(ctx, 1396)
	if err != nil {
		t.Fatal(err)
	}
	tv, err := r.tvdb.TVDBProvider.Series(ctx, 81189)
	if err != nil {
		t.Fatal(err)
	}
	id, err := r.lib.AddSeries(ctx, library.AddSeries{
		TMDB: tmdb, TVDB: tv, PrimaryLanguage: "en", Monitor: library.MonitorAll, RootFolder: r.root,
		Versions: []library.VersionSpec{{Slot: resolution.HD, Profile: "hd-primary"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	d, _ := r.lib.Get(ctx, id, library.View{Country: "US", Now: now})
	eps, _ := r.lib.Episodes(ctx, id, library.View{Country: "US", Now: now})
	var pilot library.Episode
	for _, e := range eps {
		if e.Season == 1 && e.Number == 1 {
			pilot = e
		}
	}
	folder := "Breaking Bad (2008) {tvdb-81189}"
	r.holdFile(t, id, d.Versions[0].ID, folder, "Season 01/Breaking Bad (2008) - S01E01 - [HD][WEBDL-1080p][EAC3 5.1][h264]-GRP.mkv",
		"Breaking.Bad.S01E01.1080p.WEB-DL.H264-GRP", release.KindSeries, []int64{pilot.ID})
	before := r.files(t)

	r.tvdb.edit = func(s *metadata.TVDBSeries) {
		for i := range s.Episodes {
			s.Episodes[i].Name += " (retitled)"
		}
	}
	if err := r.ref.Refresh(ctx, id); err != nil {
		t.Fatal(err)
	}
	if after := r.files(t); strings.Join(after, "|") != strings.Join(before, "|") {
		t.Errorf("an episode title change renamed: %v -> %v", before, after)
	}
	eps, _ = r.lib.Episodes(ctx, id, library.View{Country: "US", Now: now})
	if !strings.HasSuffix(eps[1].Name, "(retitled)") {
		t.Errorf("episode names were not refreshed: %+v", eps[1])
	}

	r.meta.series = func(d *metadata.SeriesDetails) { d.Title = "Breaking Bad: Reloaded" }
	if err := r.ref.Refresh(ctx, id); err != nil {
		t.Fatal(err)
	}
	files := r.files(t)
	if len(files) != 1 || !strings.HasPrefix(files[0], "Breaking Bad - Reloaded (2008) {tvdb-81189}/Season 01/Breaking Bad - Reloaded (2008) - S01E01 - [HD]") {
		t.Errorf("files = %v", files)
	}
}

func TestAVanishedUpstreamEntryRaisesTheRowAndKeepsTheStoredData(t *testing.T) {
	ctx := context.Background()
	r := newRefreshRig(t)
	id, err := r.lib.AddMovie(ctx, library.AddMovie{
		Details: metadata.MovieDetails{TMDBID: 99999, Title: "Gone Film", OriginalTitle: "Gone Film", OriginalLanguage: "en", Year: 2001, Overview: "kept"},
		PrimaryLanguage: "en", RootFolder: r.root, Versions: []library.VersionSpec{{Slot: resolution.HD, Profile: "hd-primary"}},
	})
	if err != nil {
		t.Fatal(err)
	}

	if err := r.ref.Refresh(ctx, id); err != nil {
		t.Fatal(err)
	}
	rows, _ := r.health.List(ctx)
	if len(rows) != 1 || rows[0].Kind != health.KindGoneUpstream || rows[0].Subject.TitleID != id || rows[0].Severity != health.Warning || rows[0].Dismissible {
		t.Fatalf("rows = %+v", rows)
	}
	d, _ := r.lib.Get(ctx, id, library.View{Country: "US", Now: now})
	if d.Title != "Gone Film" || d.Overview != "kept" {
		t.Errorf("stored data changed: %+v", d)
	}

	// Freezing keeps the data and the refresh leaves the Title alone from now on.
	if err := r.lib.SetMetadataFrozen(ctx, id, true); err != nil {
		t.Fatal(err)
	}
	if err := r.health.Clear(ctx, jobs.GoneUpstreamKey(id)); err != nil {
		t.Fatal(err)
	}
	if err := r.ref.Refresh(ctx, id); err != nil {
		t.Fatal(err)
	}
	if rows, _ = r.health.List(ctx); len(rows) != 0 {
		t.Errorf("a frozen Title raised again: %+v", rows)
	}
}

func TestTheDailyPassRefreshesWhatTheProvidersSayChangedAndRunsOncePerDay(t *testing.T) {
	ctx := context.Background()
	r := newRefreshRig(t)
	changedID, _ := r.addMovie(t, 116149) // in the recorded changes feed
	r.addMovie(t, 77)                     // also in the feed
	r.meta.movie = func(d *metadata.MovieDetails) { d.Overview = "refreshed " + d.Title }

	r.clock = now.Add(2 * time.Hour)
	if err := r.ref.Daily(ctx); err != nil {
		t.Fatal(err)
	}
	d, _ := r.lib.Get(ctx, changedID, library.View{Country: "US", Now: r.clock})
	if d.Overview != "refreshed Paddington" || !d.RefreshedAt.Equal(r.clock) {
		t.Errorf("detail = %+v", d)
	}

	// A second pass within the day does nothing.
	r.meta.movie = func(d *metadata.MovieDetails) { d.Overview = "again" }
	r.clock = r.clock.Add(time.Hour)
	if err := r.ref.Daily(ctx); err != nil {
		t.Fatal(err)
	}
	if d, _ = r.lib.Get(ctx, changedID, library.View{Country: "US", Now: r.clock}); d.Overview == "again" {
		t.Error("ran twice in a day")
	}
	r.clock = r.clock.Add(25 * time.Hour)
	if err := r.ref.Daily(ctx); err != nil {
		t.Fatal(err)
	}
	if d, _ = r.lib.Get(ctx, changedID, library.View{Country: "US", Now: r.clock}); d.Overview != "again" {
		t.Error("did not run the next day")
	}
}

func TestATitleNotRefreshedFor30DaysIsFullyRefreshedEvenIfNothingChanged(t *testing.T) {
	ctx := context.Background()
	r := newRefreshRig(t)
	id, err := r.lib.AddMovie(ctx, library.AddMovie{
		Details: metadata.MovieDetails{TMDBID: 116149, Title: "Paddington", OriginalTitle: "Paddington", OriginalLanguage: "en", Year: 2014},
		PrimaryLanguage: "en", RootFolder: r.root, Versions: []library.VersionSpec{{Slot: resolution.HD, Profile: "hd-primary"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	r.meta.movie = func(d *metadata.MovieDetails) { d.Overview = "stale no more" }
	r.clock = now.Add(31 * 24 * time.Hour)
	if err := r.ref.Daily(ctx); err != nil {
		t.Fatal(err)
	}
	d, _ := r.lib.Get(ctx, id, library.View{Country: "US", Now: r.clock})
	if d.Overview != "stale no more" {
		t.Errorf("overview = %q", d.Overview)
	}
}

func TestEnqueuedRefreshesRunInTheBackgroundAndWaitSeesThemDone(t *testing.T) {
	ctx := context.Background()
	r := newRefreshRig(t)
	id, _ := r.addMovie(t, 116149)
	r.meta.movie = func(d *metadata.MovieDetails) { d.Overview = "manual" }
	r.ref.Enqueue(id)
	r.ref.Wait()
	d, _ := r.lib.Get(ctx, id, library.View{Country: "US", Now: now})
	if d.Overview != "manual" {
		t.Errorf("overview = %q", d.Overview)
	}
}
