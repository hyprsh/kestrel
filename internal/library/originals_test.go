package library_test

import (
	"context"
	"testing"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/slot"
)

// An accepted Original Offer's file fills its Version: the file says it is an
// Original so acquire lets any acceptable Release replace it.
func TestAnOriginalFileFillsTheMovieVersionAndSaysSo(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	id := addPaddington(t, lib)
	d, _ := lib.Get(ctx, id, library.View{Country: "DE", Now: now})
	ver := d.Versions[0].ID

	if _, err := lib.ReplaceFile(ctx, id, "Paddington (2014)", library.NewFile{
		VersionID: ver, Path: "/m/p.mkv", Size: 1, ReleaseName: "p", Score: 5, Original: true,
	}); err != nil {
		t.Fatal(err)
	}
	d, _ = lib.Get(ctx, id, library.View{Country: "DE", Now: now})
	v := d.Versions[0]
	if v.State != library.Filled || v.File == nil || !v.File.Original || v.File.Misfit {
		t.Fatalf("version = %+v, file %+v", v, v.File)
	}
	files, _ := lib.FilesOfVersion(ctx, ver)
	if len(files) != 1 || !files[0].Original {
		t.Fatalf("files = %+v", files)
	}

	// A re-score that finds Primary-Language audio (a Profile switch) clears it.
	if err := lib.ApplyRescore(ctx, []library.Rescored{{FileID: files[0].ID, Score: 7}}); err != nil {
		t.Fatal(err)
	}
	if files, _ = lib.FilesOfVersion(ctx, ver); files[0].Original {
		t.Error("still an Original after a re-score without it")
	}
	if err := lib.ApplyRescore(ctx, []library.Rescored{{FileID: files[0].ID, Score: 7, Original: true}}); err != nil {
		t.Fatal(err)
	}
	if files, _ = lib.FilesOfVersion(ctx, ver); !files[0].Original {
		t.Error("a re-score did not mark the Original")
	}
}

func TestAnOriginalEpisodeFileFillsItsCells(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	id := addShow(t, lib, library.MonitorAll)
	d, _ := lib.Get(ctx, id, library.View{Country: "US", Now: now})
	ver := d.Versions[0].ID
	eps, _ := lib.Episodes(ctx, id, library.View{Country: "US", Now: now})

	f := newEpisodeFile(ver, "/tv/a.mkv", 10)
	f.Original = true
	if _, err := lib.ReplaceEpisodeFile(ctx, id, "F", f, []int64{eps[1].ID}); err != nil {
		t.Fatal(err)
	}
	if _, err := lib.ReplaceEpisodeFile(ctx, id, "F", newEpisodeFile(ver, "/tv/b.mkv", 10), []int64{eps[2].ID}); err != nil {
		t.Fatal(err)
	}
	got, _ := lib.Episodes(ctx, id, library.View{Country: "US", Now: now})
	if c := got[1].Cells[slot.Standard]; c.State != library.Filled || c.File == nil || !c.File.Original {
		t.Errorf("original cell = %+v (file %+v)", c, c.File)
	}
	if c := got[2].Cells[slot.Standard]; c.File == nil || c.File.Original {
		t.Errorf("Primary-Language cell = %+v (file %+v)", c, c.File)
	}
}
