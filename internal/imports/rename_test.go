package imports_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/imports"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
)

func (r *rig) importPaddington(t *testing.T) library.File {
	t.Helper()
	g := r.job(t, 1, map[string]string{"paddington.mkv": "video", "paddington.en.srt": "english subs"})
	r.prober.info["paddington.mkv"] = good()
	if res := r.svc.Import(context.Background(), g); res.Status != imports.Imported {
		t.Fatalf("import = %+v", res)
	}
	return *r.version(t).File
}

func (r *rig) refreshMovie(t *testing.T, title string, year int) {
	t.Helper()
	_, err := r.lib.RefreshMovie(context.Background(), r.titleID, library.MovieRefresh{
		Details: metadata.MovieDetails{TMDBID: 116149, Title: title, OriginalTitle: "Paddington", OriginalLanguage: "en", Year: year, Runtime: 95},
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestATitleChangeRenamesTheFolderTheFileAndItsSubtitlesTogether(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	old := r.importPaddington(t)

	r.refreshMovie(t, "Paddington Bear", 2015)
	res, err := r.svc.Rename(ctx, r.titleID)
	if err != nil {
		t.Fatal(err)
	}

	newFolder := "Paddington Bear (2015) {tmdb-116149}"
	if !res.Changed || res.Folder != newFolder || res.Files != 1 {
		t.Errorf("result = %+v", res)
	}
	files := tree(t, r.root)
	if len(files) != 2 {
		t.Fatalf("files = %v", files)
	}
	for _, f := range files {
		if !strings.HasPrefix(f, newFolder+string(filepath.Separator)+"Paddington Bear (2015) {tmdb-116149} - [Standard]") {
			t.Errorf("%q does not follow the new name", f)
		}
	}
	if _, err := os.Stat(filepath.Join(r.root, movieFolder)); !os.IsNotExist(err) {
		t.Errorf("the old folder is still there: %v", err)
	}
	v := r.version(t)
	if v.File.Path == old.Path || !strings.HasPrefix(v.File.Path, filepath.Join(r.root, newFolder)) {
		t.Errorf("recorded path = %q", v.File.Path)
	}
	if _, err := os.Stat(v.File.Path); err != nil {
		t.Errorf("the recorded file is not on disk: %v", err)
	}
	d, _ := r.lib.Get(ctx, r.titleID, library.View{Country: "US", Now: seriesNow})
	if d.Folder != newFolder {
		t.Errorf("folder = %q", d.Folder)
	}

	// Nothing left to do the second time.
	if again, err := r.svc.Rename(ctx, r.titleID); err != nil || again.Changed {
		t.Errorf("second run = %+v, %v", again, err)
	}
}

func TestARenameThatDiedAfterMovingTheFolderIsFinishedByTheRerun(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.importPaddington(t)
	r.refreshMovie(t, "Paddington Bear", 2015)
	// The folder was moved, then the process died before anything else.
	if err := os.Rename(filepath.Join(r.root, movieFolder), filepath.Join(r.root, "Paddington Bear (2015) {tmdb-116149}")); err != nil {
		t.Fatal(err)
	}

	if _, err := r.svc.Rename(ctx, r.titleID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(r.version(t).File.Path); err != nil {
		t.Errorf("the recorded file is not on disk: %v", err)
	}
}

func TestARenameNeverClobbersAFolderAlreadyAtTheNewName(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.importPaddington(t)
	r.refreshMovie(t, "Paddington Bear", 2015)
	if err := os.MkdirAll(filepath.Join(r.root, "Paddington Bear (2015) {tmdb-116149}"), 0o755); err != nil {
		t.Fatal(err)
	}

	if _, err := r.svc.Rename(ctx, r.titleID); err == nil {
		t.Fatal("want an error")
	}
	if _, err := os.Stat(r.version(t).File.Path); err != nil {
		t.Errorf("the original file moved: %v", err)
	}
}

func TestEpisodeTitleChangesNeverRenameAnything(t *testing.T) {
	ctx := context.Background()
	s := newSeriesRig(t)
	g := s.download(t, "Night.Show.S01E01.1080p.WEB-DL.H264-GRP", 1, []string{"night.show.s01e01.1080p.mkv"})
	if res := s.svc.Import(ctx, g); res.Status != imports.Imported {
		t.Fatalf("import = %+v", res)
	}
	before := tree(t, s.root)

	eps := []metadata.Episode{
		{ID: 1, Season: 1, Number: 1, Name: "Dusk, retitled", Aired: s.eps[0].AirDate},
		{ID: 2, Season: 1, Number: 2, Name: "Midnight", Aired: s.eps[1].AirDate},
	}
	res, err := s.lib.RefreshSeries(ctx, s.titleID, library.SeriesRefresh{
		TMDB: metadata.SeriesDetails{TMDBID: 7001, TVDBID: 5001, Title: "Night Show", OriginalTitle: "Night Show", OriginalLanguage: "en", Year: 2024},
		TVDB: metadata.TVDBSeries{ID: 5001, Episodes: eps},
	})
	if err != nil || res.Renamed {
		t.Fatalf("refresh = %+v, %v", res, err)
	}
	if r, err := s.svc.Rename(ctx, s.titleID); err != nil || r.Changed {
		t.Fatalf("rename = %+v, %v", r, err)
	}
	if after := tree(t, s.root); strings.Join(after, "|") != strings.Join(before, "|") {
		t.Errorf("files changed: %v -> %v", before, after)
	}
}

func TestASeriesTitleChangeRenamesTheSeriesFolderAndEveryEpisodeFile(t *testing.T) {
	ctx := context.Background()
	s := newSeriesRig(t)
	for i, e := range []string{"Night.Show.S01E01.1080p.WEB-DL.H264-GRP", "Night.Show.S02E01.1080p.WEB-DL.H264-GRP"} {
		g := s.download(t, e, int64(i+1), []string{strings.ToLower(e) + ".mkv"})
		if res := s.svc.Import(ctx, g); res.Status != imports.Imported {
			t.Fatalf("import = %+v", res)
		}
	}
	_, err := s.lib.RefreshSeries(ctx, s.titleID, library.SeriesRefresh{
		TMDB: metadata.SeriesDetails{TMDBID: 7001, TVDBID: 5001, Title: "Night Show Reborn", OriginalTitle: "Night Show", OriginalLanguage: "en", Year: 2024},
		TVDB: metadata.TVDBSeries{ID: 5001},
	})
	if err != nil {
		t.Fatal(err)
	}

	res, err := s.svc.Rename(ctx, s.titleID)
	if err != nil || res.Files != 2 {
		t.Fatalf("rename = %+v, %v", res, err)
	}
	files := tree(t, s.root)
	if len(files) != 2 {
		t.Fatalf("files = %v", files)
	}
	want := []string{"Night Show Reborn (2024) {tvdb-5001}/Season 01/Night Show Reborn (2024) - S01E01 - [Standard]", "Night Show Reborn (2024) {tvdb-5001}/Season 02/Night Show Reborn (2024) - S02E01 - [Standard]"}
	for i, f := range files {
		if !strings.HasPrefix(f, want[i]) {
			t.Errorf("%q, want prefix %q", f, want[i])
		}
	}
}
