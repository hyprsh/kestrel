package imports_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/imports"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/slot"
)

// sharedRig is a rig whose Title has a Standard (HD) Version and a 4K-Slot Any Version that both take a 1080p Release,
// with one download bound to both.
func sharedRig(t *testing.T) (*rig, imports.Grab, int64) {
	t.Helper()
	r := newRig(t)
	other, err := r.lib.AddVersion(context.Background(), r.titleID, library.VersionSpec{Slot: slot.FourK, Profile: "any-primary"})
	if err != nil {
		t.Fatal(err)
	}
	g := r.job(t, 1, map[string]string{"paddington.mkv": "video", "paddington.en.srt": "subs"})
	r.prober.info["paddington.mkv"] = good()
	g.VersionIDs = []int64{r.versions[slot.Standard], other}
	return r, g, other
}

func versionOf(t *testing.T, r *rig, id int64) library.Version {
	t.Helper()
	d, err := r.lib.Get(context.Background(), r.titleID, library.View{Country: "US", Now: time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)})
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range d.Versions {
		if v.ID == id {
			return v
		}
	}
	t.Fatalf("no Version %d", id)
	return library.Version{}
}

func TestOneDownloadBoundToTwoVersionsIsLinkedUnderEachVersionsOwnName(t *testing.T) {
	r, g, other := sharedRig(t)

	res := r.svc.Import(context.Background(), g)

	if res.Status != imports.Imported {
		t.Fatalf("result = %+v", res)
	}
	std, oth := versionOf(t, r, r.versions[slot.Standard]), versionOf(t, r, other)
	if std.File == nil || oth.File == nil || std.File.Path == oth.File.Path {
		t.Fatalf("files = %+v and %+v, want two with different names", std.File, oth.File)
	}
	if !strings.Contains(std.File.Path, "[Standard]") || !strings.Contains(oth.File.Path, "[4K]") {
		t.Errorf("names = %q and %q, want each Slot's label", std.File.Path, oth.File.Path)
	}
	a, errA := os.Stat(std.File.Path)
	b, errB := os.Stat(oth.File.Path)
	if errA != nil || errB != nil || !os.SameFile(a, b) {
		t.Errorf("the two files are not hardlinks of one: %v %v", errA, errB)
	}
	if _, err := os.Stat(filepath.Join(g.SourcePath, "paddington.mkv")); !os.IsNotExist(err) {
		t.Errorf("the download's video is still there after the last Version: %v", err)
	}
	if len(res.Paths) != 2 {
		t.Errorf("paths = %v, want both Versions' files", res.Paths)
	}
}

func TestUpgradingOnlyOneSharedVersionLeavesTheOthersFileUntouched(t *testing.T) {
	ctx := context.Background()
	r, g, other := sharedRig(t)
	if res := r.svc.Import(ctx, g); res.Status != imports.Imported {
		t.Fatalf("result = %+v", res)
	}
	std, oth := versionOf(t, r, r.versions[slot.Standard]), versionOf(t, r, other)
	// The Original-side file now scores badly, so the next Release is an Upgrade for it alone.
	if err := r.lib.ApplyRescore(ctx, []library.Rescored{{FileID: oth.File.ID, Score: -100000}}); err != nil {
		t.Fatal(err)
	}

	up := r.job(t, 2, map[string]string{"paddington.mkv": "better video"})
	up.VersionID, up.VersionIDs = other, []int64{other}
	if res := r.svc.Import(ctx, up); res.Status != imports.Imported {
		t.Fatalf("upgrade = %+v", res)
	}

	after := versionOf(t, r, r.versions[slot.Standard])
	if after.File == nil || after.File.Path != std.File.Path || after.File.ID != std.File.ID {
		t.Errorf("the untouched Version's file = %+v, want %+v", after.File, std.File)
	}
	if b, err := os.ReadFile(std.File.Path); err != nil || string(b) != "video" {
		t.Errorf("the untouched file = %q, %v", b, err)
	}
	if b, err := os.ReadFile(versionOf(t, r, other).File.Path); err != nil || string(b) != "better video" {
		t.Errorf("the upgraded file = %q, %v", b, err)
	}
}

func TestDeletingOneSharedVersionsFileLeavesTheOtherPlayable(t *testing.T) {
	ctx := context.Background()
	r, g, other := sharedRig(t)
	if res := r.svc.Import(ctx, g); res.Status != imports.Imported {
		t.Fatalf("result = %+v", res)
	}
	std, oth := versionOf(t, r, r.versions[slot.Standard]), versionOf(t, r, other)

	if _, err := r.svc.DeleteFiles(ctx, other, library.Scope{}, false); err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(oth.File.Path); !os.IsNotExist(err) {
		t.Errorf("the deleted Version's file is still there: %v", err)
	}
	if b, err := os.ReadFile(std.File.Path); err != nil || string(b) != "video" {
		t.Errorf("the other file = %q, %v, want it still playable", b, err)
	}
}

func TestARerunAfterOneSharedVersionImportedFinishesTheRest(t *testing.T) {
	ctx := context.Background()
	r, g, other := sharedRig(t)
	// A crash after the first Version's row is written: the second never ran.
	first := g
	first.VersionID, first.VersionIDs, first.CanRemove = r.versions[slot.Standard], []int64{r.versions[slot.Standard]}, false
	if res := r.svc.Import(ctx, first); res.Status != imports.Imported {
		t.Fatalf("first = %+v", res)
	}

	if res := r.svc.Import(ctx, g); res.Status != imports.Imported {
		t.Fatalf("rerun = %+v", res)
	}

	if f := versionOf(t, r, other).File; f == nil {
		t.Error("the second Version has no file after the rerun")
	}
	if f := versionOf(t, r, r.versions[slot.Standard]).File; f == nil {
		t.Error("the first Version lost its file")
	}
}
