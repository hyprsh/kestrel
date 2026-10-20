package api_test

import (
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/jobs"
)

func TestAFilledEpisodeCellCarriesItsFile(t *testing.T) {
	t.Parallel()
	s := newSeriesSearch(t)
	s.prober.set(goodProbe(), nil)
	s.publishEpisode(t, badEp1, "1", "1")
	s.pass(t, jobs.Search)
	s.finish(t, badEp1, "breaking.bad.s01e01.mkv")
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)

	eps := s.heat(t)
	f := eps[1].Cells.Standard.File
	if f == nil {
		t.Fatalf("pilot cell = %+v, want its file", eps[1].Cells.Standard)
	}
	if !strings.Contains(f.Path, "Season 01/Breaking Bad (2008) - S01E01 - [Standard]") || f.Size == 0 {
		t.Errorf("file = %+v", f)
	}
	if f.Quality == nil || *f.Quality != "WEBDL-1080p" {
		t.Errorf("quality = %v", f.Quality)
	}
	if len(f.EpisodeIDs) != 1 || f.EpisodeIDs[0] != eps[1].ID {
		t.Errorf("episode ids = %v, want the pilot alone", f.EpisodeIDs)
	}
	if eps[2].Cells.Standard.File != nil {
		t.Errorf("an episode without a file = %+v", eps[2].Cells.Standard.File)
	}
}

func TestEveryEpisodeOfAMultiEpisodeFileShowsTheSameFile(t *testing.T) {
	t.Parallel()
	s := newSeriesSearch(t)
	s.prober.set(goodProbe(), nil)
	const double = "Breaking.Bad.S01E02-E03.1080p.WEB-DL.H264-GRP"
	s.publishEpisode(t, double, "1", "2")
	s.pass(t, jobs.Search)
	s.finish(t, double, "breaking.bad.s01e02-e03.mkv")
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)

	eps := s.heat(t)
	two, three := eps[2].Cells.Standard.File, eps[3].Cells.Standard.File
	if two == nil || three == nil {
		t.Fatalf("cells = %+v / %+v, want both filled by one file", eps[2].Cells.Standard, eps[3].Cells.Standard)
	}
	if two.Path != three.Path || two.ID != three.ID || !strings.Contains(two.Path, "S01E02-E03") {
		t.Errorf("files = %+v / %+v, want one shared file", two, three)
	}
	if len(two.EpisodeIDs) != 2 || two.EpisodeIDs[0] != eps[2].ID || two.EpisodeIDs[1] != eps[3].ID {
		t.Errorf("episode ids = %v, want both episodes in aired order", two.EpisodeIDs)
	}
}
