package api_test

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"syscall"
	"testing"

	"github.com/hyprsh/kestrel/internal/app"
	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/probe"
)

type fieldProblemJSON struct {
	Code   string `json:"code"`
	Detail string `json:"detail"`
	Errors []struct {
		Field string `json:"field"`
		Code  string `json:"code"`
	} `json:"errors"`
}

// importedWithSubtitles imports Paddington's video with an English subtitle into the default Movies Root folder.
func (s *search) importedWithSubtitles(t *testing.T) (file string) {
	t.Helper()
	s.addMovie(t, `{"slot":"standard","profile":"hd-primary"}`)
	s.prober.set(goodProbe(), nil)
	s.download(t, map[string]string{"paddington.mkv": "the movie", "paddington.en.srt": "subs"})
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)
	v := s.version(t, s.hd)
	if v.File == nil {
		t.Fatal("the Version holds no file")
	}
	return v.File.Path
}

func (s search) move(root string) reply {
	return s.valid("PATCH", fmt.Sprintf("/titles/%d", s.title), fmt.Sprintf(`{"root_folder":%q}`, root))
}

func (s search) detail(t *testing.T) titleJSON {
	t.Helper()
	return decode[titleJSON](t, s.valid("GET", fmt.Sprintf("/titles/%d", s.title), ""))
}

func filesIn(t *testing.T, dir string) []string {
	t.Helper()
	var out []string
	_ = filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			rel, _ := filepath.Rel(dir, p)
			out = append(out, rel)
		}
		return nil
	})
	slices.Sort(out)
	return out
}

func TestAMovieIsMovedToAnotherRootFolderWithItsSubtitles(t *testing.T) {
	t.Parallel()
	s, ms := newMediaSearch(t)
	file := s.importedWithSubtitles(t)
	waitRefreshed(t, ms, 1)
	oldRoot := s.data + "/media/movies"
	folder := filepath.Base(filepath.Dir(file))
	before := filesIn(t, oldRoot)
	movies, _ := s.moreFolders(t)

	r := s.move(movies)
	if r.Status != 200 {
		t.Fatalf("PATCH = %d %s", r.Status, r.Body)
	}

	got := decode[titleJSON](t, r)
	if got.RootFolder != movies {
		t.Errorf("root_folder = %q, want %q", got.RootFolder, movies)
	}
	want := filepath.Join(movies, folder, filepath.Base(file))
	if f := s.version(t, s.hd).File; f == nil || f.Path != want {
		t.Errorf("file = %+v, want %s", f, want)
	}
	if d := s.detail(t); d.RootFolder != movies {
		t.Errorf("GET root_folder = %q", d.RootFolder)
	}
	if after := filesIn(t, movies); !slices.Equal(after, before) || len(after) != 2 {
		t.Errorf("new Root folder holds %v, want %v", after, before)
	}
	if _, err := os.Stat(filepath.Join(oldRoot, folder)); !os.IsNotExist(err) {
		t.Errorf("the old folder is still there: %v", err)
	}
	if told := waitRefreshed(t, ms, 3)[1:]; !slices.Contains(told, filepath.Join(movies, folder)) || !slices.Contains(told, filepath.Join(oldRoot, folder)) {
		t.Errorf("media servers told %v", told)
	}
	ev := decode[struct {
		Items []struct {
			Message string            `json:"message"`
			Data    map[string]string `json:"data"`
		} `json:"items"`
	}](t, s.valid("GET", fmt.Sprintf("/events?kind=move&title_id=%d", s.title), "")).Items
	if len(ev) != 1 || ev[0].Message != "Moved from "+oldRoot+" to "+movies || ev[0].Data["from"] != oldRoot || ev[0].Data["to"] != movies {
		t.Fatalf("events = %+v", ev)
	}
}

func TestMovingToTheCurrentRootFolderChangesNothing(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	file := s.importedWithSubtitles(t)
	s.moreFolders(t)

	if r := s.move(s.data + "/media/movies"); r.Status != 200 {
		t.Fatalf("PATCH = %d %s", r.Status, r.Body)
	}
	if f := s.version(t, s.hd).File; f == nil || f.Path != file {
		t.Errorf("file = %+v, want %s", f, file)
	}
	if ev := s.events(t, "?kind=move"); len(ev.Items) != 0 {
		t.Errorf("events = %+v", ev.Items)
	}
}

func TestARootFolderThatIsNotOneOfTheKindsIsRefused(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	s.importedWithSubtitles(t)
	_, series := s.moreFolders(t)

	for _, root := range []string{series, "/elsewhere", ""} {
		r := s.move(root)
		p := decode[fieldProblemJSON](t, r)
		if r.Status != 422 || len(p.Errors) != 1 || p.Errors[0].Field != "root_folder" || p.Errors[0].Code != "not_found" {
			t.Errorf("%q: PATCH = %d %s", root, r.Status, r.Body)
		}
	}
	if d := s.detail(t); d.RootFolder != s.data+"/media/movies" {
		t.Errorf("root_folder = %q", d.RootFolder)
	}
}

func TestAFolderOfTheSameNameInTheTargetIsAConflict(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	file := s.importedWithSubtitles(t)
	movies, _ := s.moreFolders(t)
	mkdirs(t, filepath.Join(movies, filepath.Base(filepath.Dir(file))))

	r := s.move(movies)
	if p := decode[fieldProblemJSON](t, r); r.Status != 409 || p.Code != "folder_taken" {
		t.Fatalf("PATCH = %d %s", r.Status, r.Body)
	}
	if f := s.version(t, s.hd).File; f == nil || f.Path != file {
		t.Errorf("file = %+v, want %s", f, file)
	}
	if _, err := os.Stat(file); err != nil {
		t.Errorf("the file moved: %v", err)
	}
}

func TestAMoveToAnotherFilesystemIsRefused(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t, func(o *app.Options) {
		o.RenameFolder = func(oldpath, newpath string) error {
			return &os.LinkError{Op: "rename", Old: oldpath, New: newpath, Err: syscall.EXDEV}
		}
	})
	file := s.importedWithSubtitles(t)
	movies, _ := s.moreFolders(t)

	r := s.move(movies)
	p := decode[fieldProblemJSON](t, r)
	if r.Status != 422 || len(p.Errors) != 1 || p.Errors[0].Field != "root_folder" || p.Errors[0].Code != "other_filesystem" {
		t.Fatalf("PATCH = %d %s", r.Status, r.Body)
	}
	if d := s.detail(t); d.RootFolder != s.data+"/media/movies" {
		t.Errorf("root_folder = %q", d.RootFolder)
	}
	if _, err := os.Stat(file); err != nil {
		t.Errorf("the file moved: %v", err)
	}
}

func TestATitleWhoseGrabStalledInImportingCanBeMoved(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	s.addMovie(t, `{"slot":"standard","profile":"hd-primary"}`)
	s.prober.set(probe.Info{}, probe.ErrNotInstalled)
	grab, _ := s.download(t, map[string]string{"paddington.mkv": "the movie"})
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)
	if got := s.grabState(t, grab); got != "importing" {
		t.Fatalf("Grab state = %s, want importing", got)
	}
	movies, _ := s.moreFolders(t)

	if r := s.move(movies); r.Status != 200 {
		t.Fatalf("PATCH = %d %s", r.Status, r.Body)
	}
	if d := s.detail(t); d.RootFolder != movies {
		t.Errorf("root_folder = %q", d.RootFolder)
	}
}

func TestASeriesWithNoFolderOnDiskOnlyChangesItsRootFolder(t *testing.T) {
	t.Parallel()
	s := newSeriesSearch(t)
	_, series := s.moreFolders(t)

	r := s.move(series)
	if r.Status != 200 {
		t.Fatalf("PATCH = %d %s", r.Status, r.Body)
	}
	if got := decode[titleJSON](t, r); got.RootFolder != series {
		t.Errorf("root_folder = %q", got.RootFolder)
	}
	if files := filesIn(t, series); len(files) != 0 {
		t.Errorf("new Root folder holds %v", files)
	}
	if ev := s.events(t, "?kind=move"); len(ev.Items) != 1 {
		t.Errorf("events = %+v", ev.Items)
	}
}
