package imports_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/imports"
	"github.com/hyprsh/kestrel/internal/library"
)

func (r *rig) detail(t *testing.T, id int64) library.Detail {
	t.Helper()
	d, err := r.lib.Get(context.Background(), id, library.View{Country: "US", Now: seriesNow})
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func TestAMoveTakesTheTitleFolderItsVideoAndSubtitlesToTheOtherRootFolder(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.importPaddington(t)
	before := tree(t, r.root)
	target := t.TempDir()

	res, err := r.svc.Move(ctx, r.titleID, target)
	if err != nil {
		t.Fatal(err)
	}

	if res.From != r.root || res.To != target || !res.Changed {
		t.Errorf("result = %+v", res)
	}
	if after := tree(t, target); strings.Join(after, "|") != strings.Join(before, "|") || len(after) != 2 {
		t.Errorf("target holds %v, want %v", after, before)
	}
	if _, err := os.Stat(filepath.Join(r.root, movieFolder)); !os.IsNotExist(err) {
		t.Errorf("the old folder is still there: %v", err)
	}
	d := r.detail(t, r.titleID)
	if d.RootFolder != target || d.Folder != movieFolder {
		t.Errorf("root folder = %q, folder = %q", d.RootFolder, d.Folder)
	}
	p := d.Versions[0].File.Path
	if !strings.HasPrefix(p, filepath.Join(target, movieFolder)+string(filepath.Separator)) {
		t.Errorf("recorded path = %q", p)
	}
	if _, err := os.Stat(p); err != nil {
		t.Errorf("the recorded file is not on disk: %v", err)
	}
	want := []string{filepath.Join(target, movieFolder), filepath.Join(r.root, movieFolder)}
	if got := r.notes.paths[len(r.notes.paths)-2:]; strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("media servers told %v, want %v", got, want)
	}
}

func TestAMoveTakesASeriesWithFilesInSeveralSeasons(t *testing.T) {
	ctx := context.Background()
	s := newSeriesRig(t)
	for i, e := range []string{"Night.Show.S01E01.1080p.WEB-DL.H264-GRP", "Night.Show.S02E01.1080p.WEB-DL.H264-GRP"} {
		if res := s.svc.Import(ctx, s.download(t, e, int64(i+1), []string{strings.ToLower(e) + ".mkv"})); res.Status != imports.Imported {
			t.Fatalf("import = %+v", res)
		}
	}
	before := tree(t, s.root)
	target := t.TempDir()

	res, err := s.svc.Move(ctx, s.titleID, target)
	if err != nil || res.Files != 2 {
		t.Fatalf("move = %+v, %v", res, err)
	}
	if after := tree(t, target); strings.Join(after, "|") != strings.Join(before, "|") {
		t.Errorf("target holds %v, want %v", after, before)
	}
	if left := tree(t, s.root); len(left) != 0 {
		t.Errorf("left behind: %v", left)
	}
	files, err := s.lib.RenameFiles(ctx, s.titleID)
	if err != nil || len(files) != 2 {
		t.Fatalf("files = %+v, %v", files, err)
	}
	for _, f := range files {
		if !strings.HasPrefix(f.Path, target+string(filepath.Separator)) {
			t.Errorf("recorded at %q", f.Path)
		}
		if _, err := os.Stat(f.Path); err != nil {
			t.Errorf("not on disk: %v", err)
		}
	}
}

func TestAMoveToTheCurrentRootFolderDoesNothing(t *testing.T) {
	r := newRig(t)
	r.importPaddington(t)
	before := tree(t, r.root)
	told := len(r.notes.paths)

	res, err := r.svc.Move(context.Background(), r.titleID, r.root+string(filepath.Separator))
	if err != nil || res.Changed || res.From != r.root || res.To != r.root {
		t.Fatalf("move = %+v, %v", res, err)
	}
	if after := tree(t, r.root); strings.Join(after, "|") != strings.Join(before, "|") {
		t.Errorf("files changed: %v -> %v", before, after)
	}
	if len(r.notes.paths) != told {
		t.Errorf("media servers told %v", r.notes.paths[told:])
	}
}

// unchanged fails unless the Title, its file and the target are as before a failed Move.
func (r *rig) unchanged(t *testing.T, file library.File, target string, targetFiles []string) {
	t.Helper()
	d := r.detail(t, r.titleID)
	if d.RootFolder != r.root || d.Versions[0].File.Path != file.Path {
		t.Errorf("recorded %q, %q; want %q, %q", d.RootFolder, d.Versions[0].File.Path, r.root, file.Path)
	}
	if _, err := os.Stat(file.Path); err != nil {
		t.Errorf("the file moved: %v", err)
	}
	if got := tree(t, target); strings.Join(got, "|") != strings.Join(targetFiles, "|") {
		t.Errorf("target holds %v, want %v", got, targetFiles)
	}
}

func TestAMoveNeverClobbersAFolderOfTheSameNameInTheTarget(t *testing.T) {
	r := newRig(t)
	file := r.importPaddington(t)
	target := t.TempDir()
	if err := os.MkdirAll(filepath.Join(target, movieFolder), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, movieFolder, "theirs.mkv"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := r.svc.Move(context.Background(), r.titleID, target); !errors.Is(err, imports.ErrFolderTaken) {
		t.Fatalf("err = %v, want ErrFolderTaken", err)
	}
	r.unchanged(t, file, target, []string{filepath.Join(movieFolder, "theirs.mkv")})
}

func TestAMoveAcrossFilesystemsIsRefusedAndChangesNothing(t *testing.T) {
	r := newRig(t)
	file := r.importPaddington(t)
	r.crossDeviceRename = true
	target := t.TempDir()

	if _, err := r.svc.Move(context.Background(), r.titleID, target); !errors.Is(err, imports.ErrOtherFilesystem) {
		t.Fatalf("err = %v, want ErrOtherFilesystem", err)
	}
	r.unchanged(t, file, target, nil)
}

func TestAMoveWhoseDatabaseWriteFailsMovesTheFolderBack(t *testing.T) {
	r := newRig(t)
	file := r.importPaddington(t)
	before := tree(t, r.root)
	r.failMove = true
	target := t.TempDir()
	told := len(r.notes.paths)

	if _, err := r.svc.Move(context.Background(), r.titleID, target); err == nil {
		t.Fatal("want an error")
	}
	r.unchanged(t, file, target, nil)
	if after := tree(t, r.root); strings.Join(after, "|") != strings.Join(before, "|") {
		t.Errorf("old Root folder holds %v, want %v", after, before)
	}
	if len(r.notes.paths) != told {
		t.Errorf("media servers told %v", r.notes.paths[told:])
	}
}

func TestATitleWithNoFolderOnDiskOnlyChangesItsRootFolder(t *testing.T) {
	r := newRig(t)
	target := t.TempDir()

	res, err := r.svc.Move(context.Background(), r.titleID, target)
	if err != nil || res.Changed || res.To != target {
		t.Fatalf("move = %+v, %v", res, err)
	}
	if d := r.detail(t, r.titleID); d.RootFolder != target {
		t.Errorf("root folder = %q", d.RootFolder)
	}
	if files := tree(t, target); len(files) != 0 {
		t.Errorf("target holds %v", files)
	}
	if len(r.notes.paths) != 0 {
		t.Errorf("media servers told %v", r.notes.paths)
	}
}

func TestAMoveWhileAnImportIntoTheTitleRunsIsRefused(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	inside, done := make(chan struct{}), make(chan struct{})
	r.hook = func(step string) error {
		if step == "partial" {
			close(inside)
			<-done
		}
		return nil
	}
	g := r.job(t, 1, map[string]string{"paddington.mkv": "video"})
	r.prober.info["paddington.mkv"] = good()
	imported := make(chan imports.Result)
	go func() { imported <- r.svc.Import(ctx, g) }()
	<-inside
	target := t.TempDir()

	_, err := r.svc.Move(ctx, r.titleID, target)
	close(done)
	if !errors.Is(err, imports.ErrImportRunning) {
		t.Fatalf("err = %v, want ErrImportRunning", err)
	}
	res := <-imported
	if res.Status != imports.Imported || !strings.HasPrefix(res.Path, r.root) {
		t.Fatalf("import = %+v", res)
	}
	if d := r.detail(t, r.titleID); d.RootFolder != r.root {
		t.Errorf("root folder = %q", d.RootFolder)
	}

	// Once the Import is done, the move goes through.
	r.hook = nil
	if _, err := r.svc.Move(ctx, r.titleID, target); err != nil {
		t.Fatal(err)
	}
}

func TestAStalledImportRunAgainAfterAMoveLandsInTheNewRootFolder(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	g := r.job(t, 1, map[string]string{"paddington.mkv": "video"})
	r.prober.notInstalled = true
	if res := r.svc.Import(ctx, g); res.Status != imports.Stalled {
		t.Fatalf("import = %+v", res)
	}
	target := t.TempDir()
	if _, err := r.svc.Move(ctx, r.titleID, target); err != nil {
		t.Fatal(err)
	}

	r.prober.notInstalled = false
	r.prober.info["paddington.mkv"] = good()
	res := r.svc.Import(ctx, g)
	if res.Status != imports.Imported || !strings.HasPrefix(res.Path, filepath.Join(target, movieFolder)) {
		t.Fatalf("import = %+v", res)
	}
}
