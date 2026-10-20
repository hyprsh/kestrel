package imports_test

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/imports"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/slot"
)

// Night Show lists S01E01-E03 and S02E01.

func (s *seriesRig) at(t *testing.T, season, number int) (library.Episode, bool) {
	t.Helper()
	for _, e := range s.episodes(t) {
		if e.Season == season && e.Number == number {
			return e, true
		}
	}
	return library.Episode{}, false
}

func TestAPackFileForAQualifyingUnlistedEpisodeImportsAsAPlaceholderEpisode(t *testing.T) {
	s := newSeriesRig(t)
	g := s.download(t, packName, 1, []string{
		"Night.Show.S01E01.1080p.WEB-DL.H264-GRP.mkv", "Night.Show.S01E04.1080p.WEB-DL.H264-GRP.mkv", "Night.Show.S01E06.1080p.WEB-DL.H264-GRP.mkv",
	})

	res := s.svc.Import(context.Background(), g)

	if res.Status != imports.Imported {
		t.Fatalf("result = %+v", res)
	}
	if e := resultOf(t, res, 1, 1); e.Status != imports.Imported {
		t.Errorf("E01 = %+v", e)
	}
	e4 := resultOf(t, res, 1, 4)
	if e4.Status != imports.Imported || filepath.Dir(e4.Path) != filepath.Join(s.root, seriesRoot, "Season 01") ||
		!strings.HasPrefix(filepath.Base(e4.Path), "Night Show (2024) - S01E04 - [Standard]") {
		t.Errorf("E04 = %+v", e4)
	}
	p, ok := s.at(t, 1, 4)
	if !ok || !p.Placeholder || p.ID != e4.EpisodeID || p.Cells[slot.Standard].State != library.Filled {
		t.Errorf("S01E04 = %+v, %v", p, ok)
	}
	if e := resultOf(t, res, 1, 6); e.Status != imports.Rejected || e.Reason != imports.ReasonUnknownEpisode {
		t.Errorf("E06 = %+v", e)
	}
	if _, ok := s.at(t, 1, 6); ok {
		t.Error("added S01E06, beyond the limit")
	}
}

func TestAFileForAPlaceholderEpisodeAGrabAddedBeyondTheLimitImports(t *testing.T) {
	ctx := context.Background()
	s := newSeriesRig(t)
	if err := s.lib.AddPlaceholders(ctx, s.titleID, []library.EpisodeRef{{Season: 1, Number: 9}}); err != nil {
		t.Fatal(err)
	}
	g := s.download(t, "Night.Show.S01E09.1080p.WEB-DL.H264-GRP", 2, []string{"night.show.s01e09.mkv"})

	res := s.svc.Import(ctx, g)

	if res.Status != imports.Imported || !strings.Contains(filepath.Base(res.Path), "S01E09") {
		t.Fatalf("result = %+v", res)
	}
}
