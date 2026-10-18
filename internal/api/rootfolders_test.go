package api_test

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/app"
)

type rootFoldersJSON struct {
	RootFolders struct {
		Movies []string `json:"movies"`
		Series []string `json:"series"`
	} `json:"root_folders"`
}

type setupJSON struct {
	Completed bool `json:"completed"`
	Sections  struct {
		RootFolders string `json:"root_folders"`
	} `json:"sections"`
}

func dataDirInstance(t *testing.T) (*browser, string) {
	t.Helper()
	data := t.TempDir()
	in := newInstance(t, "", func(o *app.Options) { o.DataDir = data })
	return in.setUp(), data
}

func mkdirs(t *testing.T, paths ...string) {
	t.Helper()
	for _, p := range paths {
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatal(err)
		}
	}
}

func TestRootFoldersArePrefilledFromTheDataDir(t *testing.T) {
	b, data := dataDirInstance(t)
	got := decode[rootFoldersJSON](t, b.valid("GET", "/settings", ""))
	if len(got.RootFolders.Movies) != 1 || got.RootFolders.Movies[0] != data+"/media/movies" {
		t.Errorf("movies = %v", got.RootFolders.Movies)
	}
	if len(got.RootFolders.Series) != 1 || got.RootFolders.Series[0] != data+"/media/tv" {
		t.Errorf("series = %v", got.RootFolders.Series)
	}
	if s := decode[setupJSON](t, b.valid("GET", "/setup", "")); s.Sections.RootFolders != "todo" {
		t.Errorf("unsaved root_folders = %q", s.Sections.RootFolders)
	}
}

func TestRootFoldersSaveAndMarkTheSectionDone(t *testing.T) {
	b, data := dataDirInstance(t)
	mkdirs(t, data+"/media/movies", data+"/media/movies2", data+"/media/tv")
	body := fmt.Sprintf(`{"root_folders":{"movies":[%q,%q],"series":[%q]}}`, data+"/media/movies", data+"/media/movies2", data+"/media/tv")
	got := decode[rootFoldersJSON](t, b.valid("PATCH", "/settings", body))
	if len(got.RootFolders.Movies) != 2 || got.RootFolders.Movies[1] != data+"/media/movies2" {
		t.Errorf("movies = %v", got.RootFolders.Movies)
	}
	again := decode[rootFoldersJSON](t, b.valid("GET", "/settings", ""))
	if len(again.RootFolders.Movies) != 2 {
		t.Errorf("not stored: %v", again.RootFolders.Movies)
	}
	if s := decode[setupJSON](t, b.valid("GET", "/setup", "")); s.Sections.RootFolders != "done" {
		t.Errorf("saved root_folders = %q", s.Sections.RootFolders)
	}
}

func TestRootFoldersAreCheckedWhenSaved(t *testing.T) {
	b, data := dataDirInstance(t)
	file := filepath.Join(data, "afile")
	if err := os.WriteFile(file, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	ro := filepath.Join(data, "ro")
	mkdirs(t, ro)
	if err := os.Chmod(ro, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(ro, 0o755) })
	probe := filepath.Join(ro, ".x")
	canWrite := os.WriteFile(probe, nil, 0o644) == nil // root ignores modes
	_ = os.Remove(probe)

	type tc struct{ name, path, code string }
	cases := []tc{
		{"missing", data + "/nope", "not_found"},
		{"file", file, "not_directory"},
		{"relative", "media/movies", "not_absolute"},
		{"empty", "", "required"},
	}
	if !canWrite {
		cases = append(cases, tc{"read-only", ro, "not_writable"})
	}
	for _, c := range cases {
		body := fmt.Sprintf(`{"root_folders":{"movies":[%q]}}`, c.path)
		r := b.do("PATCH", "/settings", body)
		if r.Status != 422 || !strings.Contains(r.Body, `"field":"root_folders.movies[0]"`) || !strings.Contains(r.Body, `"code":"`+c.code+`"`) {
			t.Errorf("%s: %d %s", c.name, r.Status, r.Body)
		}
	}
	if r := b.do("PATCH", "/settings", `{"root_folders":{"movies":[]}}`); r.Status != 422 {
		t.Errorf("empty list = %d %s", r.Status, r.Body)
	}
	if s := decode[setupJSON](t, b.valid("GET", "/setup", "")); s.Sections.RootFolders != "todo" {
		t.Errorf("rejected patches marked done: %q", s.Sections.RootFolders)
	}
}

func TestARejectedSettingsPatchSavesNothing(t *testing.T) {
	for _, c := range []struct{ name, rest string }{
		{"language", `"language_region":{"primary_language":"de","release_date_country":"nope"}`},
	} {
		t.Run(c.name, func(t *testing.T) {
			b, data := dataDirInstance(t)
			mkdirs(t, data+"/films")
			before := decode[settingsJSON](t, b.valid("GET", "/settings", ""))
			body := fmt.Sprintf(`{"root_folders":{"movies":[%q]},%s}`, data+"/films", c.rest)
			if r := b.do("PATCH", "/settings", body); r.Status != 422 {
				t.Fatalf("patch = %d %s", r.Status, r.Body)
			}
			again := b.valid("GET", "/settings", "")
			if after := decode[settingsJSON](t, again); after != before {
				t.Errorf("settings changed: %+v -> %+v", before, after)
			}
			if got := decode[rootFoldersJSON](t, again).RootFolders.Movies; len(got) != 1 || got[0] != data+"/media/movies" {
				t.Errorf("root folders saved by a rejected patch: %v", got)
			}
			if s := decode[setupJSON](t, b.valid("GET", "/setup", "")); s.Sections.RootFolders != "todo" {
				t.Errorf("root_folders = %q", s.Sections.RootFolders)
			}
		})
	}
}

func TestFinishSetupNamesEveryMissingSection(t *testing.T) {
	b, _ := dataDirInstance(t)
	if s := decode[setupJSON](t, b.valid("GET", "/setup", "")); s.Completed {
		t.Fatal("fresh instance reports completed")
	}
	r := b.do("POST", "/setup/complete", "")
	if r.Status != 422 {
		t.Fatalf("complete on a fresh instance = %d %s", r.Status, r.Body)
	}
	for _, section := range []string{"language", "download_client", "indexer", "root_folders"} {
		if !strings.Contains(r.Body, `"field":"sections.`+section+`"`) {
			t.Errorf("missing list lacks %s: %s", section, r.Body)
		}
	}
	if strings.Contains(r.Body, `"field":"sections.account"`) {
		t.Errorf("account is done but listed: %s", r.Body)
	}
	if s := decode[setupJSON](t, b.valid("GET", "/setup", "")); s.Completed {
		t.Error("a refused finish marked setup completed")
	}
}

func TestFinishSetupWhenEverySectionIsDone(t *testing.T) {
	sab, idx := fakeSAB(t), fakeIndexer(t)
	data := t.TempDir()
	b := newInstance(t, "", withSABAndNewznab(t), func(o *app.Options) { o.DataDir = data }).setUp()
	mkdirs(t, data+"/media/movies", data+"/media/tv")

	b.valid("POST", "/plugin-instances", sabBody(sab.URL, sabKey, ""))
	b.valid("POST", "/plugin-instances", newznabBody("Geek", idx.URL, nzbKey, ""))
	b.valid("PATCH", "/settings", `{"language_region":{"primary_language":"de"},"root_folders":{"movies":["`+data+`/media/movies"],"series":["`+data+`/media/tv"]}}`)

	if r := b.valid("POST", "/setup/complete", ""); r.Status != 204 {
		t.Fatalf("complete = %d %s", r.Status, r.Body)
	}
	if s := decode[setupJSON](t, b.valid("GET", "/setup", "")); !s.Completed {
		t.Error("setup not completed after finishing")
	}
}

func TestRootFoldersHaveOnlyMoviesAndSeries(t *testing.T) {
	b, data := dataDirInstance(t)
	movies, more, tv := data+"/media/movies", data+"/media/more-movies", data+"/media/tv"
	mkdirs(t, movies, more, tv)

	body := b.valid("GET", "/settings", "").Body
	if strings.Contains(body, "kids") {
		t.Errorf("unsaved settings mention kids: %s", body)
	}
	got := decode[rootFoldersJSON](t, b.valid("PATCH", "/settings", fmt.Sprintf(`{"root_folders":{"movies":[%q,%q]}}`, movies, more)))
	if len(got.RootFolders.Movies) != 2 {
		t.Errorf("saved = %+v", got.RootFolders)
	}
	// Any list can drop any folder: nothing else refers to it.
	got = decode[rootFoldersJSON](t, b.valid("PATCH", "/settings", fmt.Sprintf(`{"root_folders":{"movies":[%q]}}`, movies)))
	if len(got.RootFolders.Movies) != 1 {
		t.Errorf("after dropping a folder = %+v", got.RootFolders)
	}
}
