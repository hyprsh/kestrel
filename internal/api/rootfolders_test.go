package api_test

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/api"
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
	in := newInstance(t, "", func(o *api.Options) { o.DataDir = data })
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
