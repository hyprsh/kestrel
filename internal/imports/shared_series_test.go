package imports_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/imports"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/slot"
)

func TestASeasonPackBoundToTwoVersionsIsLinkedAsEpisodeFilesUnderEachVersionsName(t *testing.T) {
	ctx := context.Background()
	s := newSeriesRig(t)
	other, err := s.lib.AddVersion(ctx, s.titleID, library.VersionSpec{Slot: slot.FourK, Profile: "any-primary"})
	if err != nil {
		t.Fatal(err)
	}
	g := s.download(t, packName, 7, []string{"Night.Show.S01E01.1080p.WEB-DL.H264-GRP.mkv", "Night.Show.S01E02.1080p.WEB-DL.H264-GRP.mkv"})
	g.VersionIDs = []int64{s.version, other}

	res := s.svc.Import(ctx, g)

	if res.Status != imports.Imported {
		t.Fatalf("result = %+v", res)
	}
	for _, e := range s.episodes(t)[:2] {
		for _, sl := range []slot.Slot{slot.Standard, slot.FourK} {
			if c := e.Cells[sl]; c == nil || c.State != library.Filled {
				t.Fatalf("S%02dE%02d cell %v = %+v, want Filled", e.Season, e.Number, sl, c)
			}
		}
	}
	entries, _ := os.ReadDir(filepath.Join(s.root, seriesRoot, "Season 01"))
	if len(entries) != 4 {
		t.Fatalf("season folder holds %d files, want 2 per Version", len(entries))
	}
	var std, oth []os.FileInfo
	for _, e := range entries {
		fi, _ := e.Info()
		switch {
		case strings.Contains(e.Name(), "[Standard]"):
			std = append(std, fi)
		case strings.Contains(e.Name(), "[4K]"):
			oth = append(oth, fi)
		}
	}
	if len(std) != 2 || len(oth) != 2 {
		t.Fatalf("names = %v", entries)
	}
	if !os.SameFile(std[0], oth[0]) && !os.SameFile(std[0], oth[1]) {
		t.Error("the two Versions' files are copies, want hardlinks of one download")
	}
	seen := map[int64]bool{}
	for _, e := range res.Episodes {
		seen[e.VersionID] = true
	}
	if !seen[s.version] || !seen[other] {
		t.Errorf("episode results name Versions %v, want both", seen)
	}
}

func TestASeasonPackOnAnotherFilesystemIsCopiedOnceAndLinkedUnderTheOtherVersionsNames(t *testing.T) {
	ctx := context.Background()
	s := newSeriesRig(t)
	s.crossDeviceFromDownloads = true
	other, err := s.lib.AddVersion(ctx, s.titleID, library.VersionSpec{Slot: slot.FourK, Profile: "any-primary"})
	if err != nil {
		t.Fatal(err)
	}
	g := s.download(t, packName, 9, []string{"Night.Show.S01E01.1080p.WEB-DL.H264-GRP.mkv"})
	g.VersionIDs = []int64{s.version, other}

	if res := s.svc.Import(ctx, g); res.Status != imports.Imported {
		t.Fatalf("result = %+v", res)
	}
	entries, _ := os.ReadDir(filepath.Join(s.root, seriesRoot, "Season 01"))
	if len(entries) != 2 {
		t.Fatalf("season folder holds %d files, want 1 per Version", len(entries))
	}
	a, _ := entries[0].Info()
	b, _ := entries[1].Info()
	if !os.SameFile(a, b) {
		t.Error("the second Version's file is a second copy of the download, want a hardlink of the first")
	}
}

func TestASharedPackThatOneVersionHasNothingToTakeFromStillImportsForTheOther(t *testing.T) {
	ctx := context.Background()
	s := newSeriesRig(t)
	other, err := s.lib.AddVersion(ctx, s.titleID, library.VersionSpec{Slot: slot.FourK, Profile: "any-primary"})
	if err != nil {
		t.Fatal(err)
	}
	// The second Version already holds a better file for every episode the pack names.
	for _, ep := range s.eps[:2] {
		if _, err := s.lib.ReplaceEpisodeFile(ctx, s.titleID, seriesRoot, library.NewFile{VersionID: other, Path: filepath.Join(s.root, "held", ep.Name+".mkv"), Size: 1, ReleaseName: "old", Score: 1000000}, []int64{ep.ID}); err != nil {
			t.Fatal(err)
		}
	}
	g := s.download(t, packName, 8, []string{"Night.Show.S01E01.1080p.WEB-DL.H264-GRP.mkv", "Night.Show.S01E02.1080p.WEB-DL.H264-GRP.mkv"})
	g.VersionIDs = []int64{s.version, other}

	res := s.svc.Import(ctx, g)

	if res.Status != imports.Imported {
		t.Fatalf("result = %+v, want the Release kept: one Version taking nothing is not a rejection", res)
	}
}
