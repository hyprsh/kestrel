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
	if f.ReleaseName != badEp1 || len(f.Languages) != 1 || f.Languages[0] != "English" || f.ImportedAt == "" {
		t.Errorf("release name, languages or import date = %q / %v / %q", f.ReleaseName, f.Languages, f.ImportedAt)
	}
	if f.ReleaseGroup == nil || *f.ReleaseGroup != "GRP" {
		t.Errorf("release group = %v, want GRP", f.ReleaseGroup)
	}
	// The name says H.264; the probe says E-AC-3 in 5.1; the name has no HDR.
	str := func(p *string) string {
		if p == nil {
			return "<null>"
		}
		return *p
	}
	if str(f.VideoCodec) != "H.264" || str(f.AudioCodec) != "DDP" || str(f.AudioChannels) != "5.1" || f.HDR != nil {
		t.Errorf("media = %s / %s / %s / %s, want H.264 / null / DDP / 5.1", str(f.VideoCodec), str(f.HDR), str(f.AudioCodec), str(f.AudioChannels))
	}
	if f.CustomFormats == nil {
		t.Error("the file has no custom_formats list")
	}
	sum := 0
	for _, cf := range f.CustomFormats {
		sum += cf.Points
	}
	if c := eps[1].Cells.Standard; c.Score == nil || sum != *c.Score {
		t.Errorf("custom formats %+v add up to %d, want the cell Score %v", f.CustomFormats, sum, c.Score)
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

func TestAnEpisodeFileListsTheCustomFormatsItMatchesWithTheirPoints(t *testing.T) {
	t.Parallel()
	s := newSeriesSearch(t)
	s.prober.set(goodProbe(), nil)
	const rel = "Breaking.Bad.S01E01.1080p.AMZN.WEB-DL.DDP5.1.H.264-NTb"
	s.publishEpisode(t, rel, "1", "1")
	s.pass(t, jobs.Search)
	s.finish(t, rel, "breaking.bad.s01e01.mkv")
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)

	c := s.heat(t)[1].Cells.Standard
	if c.File == nil || len(c.File.CustomFormats) == 0 {
		t.Fatalf("cell = %+v, want matched Custom Formats", c)
	}
	sum := 0
	for _, cf := range c.File.CustomFormats {
		sum += cf.Points
	}
	if c.Score == nil || sum != *c.Score {
		t.Errorf("custom formats %+v add up to %d, want the cell Score %v", c.File.CustomFormats, sum, c.Score)
	}
}
