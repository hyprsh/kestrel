package api_test

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"testing"
	"testing/fstest"
	"time"

	"github.com/hyprsh/kestrel/internal/app"
	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/scoring/trashsync"
)

type trashSource struct {
	ref   trashsync.Ref
	files fs.FS
}

func (s *trashSource) Latest(context.Context) (trashsync.Ref, error) { return s.ref, nil }
func (s *trashSource) Download(context.Context, trashsync.Ref) (fs.FS, error) {
	return s.files, nil
}

// trashBundle is the embedded snapshot's directories with a new commit, so a
// valid update that changes nothing about the Scores still has to load.
func trashBundle(t *testing.T, commit string) fs.FS {
	t.Helper()
	m := fstest.MapFS{
		"COMMIT":       {Data: []byte(commit)},
		"COMMITTED_AT": {Data: []byte(time.Now().UTC().Format(time.RFC3339))},
	}
	root := os.DirFS("../scoring/trash")
	err := fs.WalkDir(root, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || p == "COMMIT" || p == "COMMITTED_AT" {
			return err
		}
		b, err := fs.ReadFile(root, p)
		m[p] = &fstest.MapFile{Data: b}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return m
}

type trashStatus struct {
	Trash struct {
		Commit     string `json:"commit"`
		AutoUpdate bool   `json:"auto_update"`
	} `json:"trash"`
}

func TestUpdateFromTrashLoadsAValidSnapshotAndRejectsABrokenOneWhole(t *testing.T) {
	t.Parallel()
	src := &trashSource{}
	s := newSearchBare(t, func(o *app.Options) { o.TrashSource = src })
	s.addMovie(t, `{"slot":"standard","profile":"hd-primary"}`)
	s.prober.set(goodProbe(), nil)
	s.download(t, map[string]string{"paddington.mkv": "the movie"})
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)
	before := s.version(t, s.hd)

	src.ref = trashsync.Ref{Commit: "broken", CommittedAt: time.Now()}
	src.files = fstest.MapFS{"COMMIT": {Data: []byte("broken")}}
	if r := s.valid("POST", "/trash/update", ``); r.Status != 202 {
		t.Fatalf("broken update = %d %s, want 202: the pass reports the rejection", r.Status, r.Body)
	}
	if err := s.in.app.Jobs.Pass(context.Background(), jobs.Trash); !errors.Is(err, trashsync.ErrRejected) {
		t.Fatalf("the pass = %v, want a rejection", err)
	}
	if o := s.jobList(t)[jobs.Trash].Outcome; o == nil || o.Kind != "rejected" {
		t.Errorf("outcome = %+v, want rejected", o)
	}
	if got := decode[trashStatus](t, s.valid("GET", "/system/status", "")); got.Trash.Commit == "broken" {
		t.Error("the broken snapshot is active")
	}
	if a := decode[attentionJSON](t, s.valid("GET", "/attention", "")); !a.has("trash_update_rejected") {
		t.Errorf("no TRaSH update rejected Warning in %v", a.kinds())
	}

	src.ref = trashsync.Ref{Commit: "good", CommittedAt: time.Now()}
	src.files = trashBundle(t, "good")
	if r := s.valid("POST", "/trash/update", ``); r.Status != 202 {
		t.Fatalf("good update = %d %s", r.Status, r.Body)
	}
	if got := decode[trashStatus](t, s.valid("GET", "/system/status", "")); got.Trash.Commit == "good" {
		t.Error("the snapshot is active before the pass ran")
	}
	if err := s.in.app.Jobs.Pass(context.Background(), jobs.Trash); err != nil {
		t.Fatal(err)
	}
	if got := decode[trashStatus](t, s.valid("GET", "/system/status", "")); got.Trash.Commit != "good" || !got.Trash.AutoUpdate {
		t.Errorf("status = %+v, want the good commit and auto update on", got)
	}
	if a := decode[attentionJSON](t, s.valid("GET", "/attention", "")); a.has("trash_update_rejected") {
		t.Error("the Warning stayed after a good update")
	}
	after := s.version(t, s.hd)
	if after.File == nil || before.File == nil || after.File.Path != before.File.Path {
		t.Errorf("the file moved: %+v -> %+v", before.File, after.File)
	}
}

// trashPass runs the trash loop's pass, as a kick would.
func (b *browser) trashPass(t *testing.T) {
	t.Helper()
	if err := b.in.app.Jobs.Pass(context.Background(), jobs.Trash); err != nil {
		t.Fatal(err)
	}
}

func TestChangingThePrimaryLanguageRescoresFilesWithoutRenamingOrSearching(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	s.addMovie(t, `{"slot":"standard","profile":"hd-primary"}`)
	s.prober.set(goodProbe(), nil)
	s.download(t, map[string]string{"paddington.mkv": "the movie"})
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)
	before := s.version(t, s.hd)
	if before.File == nil || before.File.Misfit {
		t.Fatalf("version = %+v, want a fitting English file", before)
	}
	queued := len(s.queue(t))

	if r := s.valid("PATCH", "/settings", `{"language_region":{"primary_language":"de"}}`); r.Status != 200 {
		t.Fatalf("PATCH /settings = %d %s", r.Status, r.Body)
	}
	if got := s.version(t, s.hd); got.File == nil || got.File.Misfit {
		t.Fatalf("file = %+v: the PATCH re-scored before returning", got.File)
	}
	if got := decode[settingsJSON](t, s.valid("GET", "/settings", "")).LanguageRegion; got.PrimaryLanguage != "en" || got.PendingLanguage != "de" {
		t.Errorf("settings before the pass = %+v, want English with German pending: Language and Scores change together", got)
	}
	if err := s.in.app.Jobs.Pass(context.Background(), jobs.Trash); err != nil {
		t.Fatal(err)
	}

	after := s.version(t, s.hd)
	if after.File == nil || !after.File.Misfit || after.File.Path != before.File.Path {
		t.Fatalf("file = %+v, want the same path, now a misfit for a German household", after.File)
	}
	if _, err := os.Stat(before.File.Path); err != nil {
		t.Errorf("the file was renamed or removed: %v", err)
	}
	if got := len(s.queue(t)); got != queued {
		t.Errorf("queue grew from %d to %d: the change must not search", queued, got)
	}
}

func TestTheTrashSwitchIsSavedWithTheSettings(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	if r := s.valid("PATCH", "/settings", `{"trash":{"auto_update":false}}`); r.Status != 200 {
		t.Fatalf("PATCH /settings = %d %s", r.Status, r.Body)
	}
	if got := decode[trashStatus](t, s.valid("GET", "/settings", "")); got.Trash.AutoUpdate {
		t.Error("auto_update is still on")
	}
}

func TestASecondLanguageChangeWhileOneWaitsReplacesIt(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	s.valid("PATCH", "/settings", `{"language_region":{"primary_language":"de"}}`)
	s.valid("PATCH", "/settings", `{"language_region":{"primary_language":"fr","release_date_country":"BE"}}`)
	if got := decode[settingsJSON](t, s.valid("GET", "/settings", "")).LanguageRegion; got.PendingLanguage != "fr" {
		t.Errorf("pending = %q, want fr", got.PendingLanguage)
	}
	if err := s.in.app.Jobs.Pass(context.Background(), jobs.Trash); err != nil {
		t.Fatal(err)
	}
	if got := decode[settingsJSON](t, s.valid("GET", "/settings", "")).LanguageRegion; got.PrimaryLanguage != "fr" || got.ReleaseDateCountry != "BE" || got.PendingLanguage != "" {
		t.Errorf("settings = %+v, want French, BE, nothing pending", got)
	}
}

func TestAnInvalidPrimaryLanguageIsRefusedAtOnce(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	if r := s.valid("PATCH", "/settings", `{"language_region":{"primary_language":"xx"}}`); r.Status != 422 {
		t.Fatalf("PATCH = %d %s, want 422", r.Status, r.Body)
	}
	if got := decode[settingsJSON](t, s.valid("GET", "/settings", "")).LanguageRegion; got.PendingLanguage != "" {
		t.Errorf("pending = %q after a refused patch", got.PendingLanguage)
	}
}
