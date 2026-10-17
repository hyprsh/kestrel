package release_test

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/hyprsh/kestrel/internal/release"
)

func mustParse(t *testing.T, name string) release.ParsedRelease {
	t.Helper()
	p, err := release.Parse(name, release.KindMovie)
	if err != nil {
		t.Fatalf("Parse(%q): %v", name, err)
	}
	return p
}

func TestParseReadsAMovieRelease(t *testing.T) {
	p := mustParse(t, "Movie.Hills.2019.Extended.German.DL.AC3.Dubbed.1080p.BluRay.x264-muhHD")

	if p.Kind != release.KindMovie {
		t.Errorf("kind = %q", p.Kind)
	}
	if p.Title() != "Movie Hills" || p.Year != 2019 || p.Edition != "Extended" || p.ReleaseGroup != "muhHD" {
		t.Errorf("title/year/edition/group = %q %d %q %q", p.Title(), p.Year, p.Edition, p.ReleaseGroup)
	}
	if q := p.Quality.Quality; q.Name != "Bluray-1080p" || q.Source != release.SourceBluray || q.Resolution != 1080 {
		t.Errorf("quality = %+v", q)
	}
	want := []release.Language{release.LangGerman, release.LangOriginal}
	if !reflect.DeepEqual(p.Languages, want) {
		t.Errorf("languages = %v, want German and Original (the DL token)", p.Languages)
	}
}

func TestParseKeepsOriginalForScoringToResolve(t *testing.T) {
	cases := map[string][]release.Language{
		"Film.2020.German.DL.1080p.WEB.H264-GRP": {release.LangGerman, release.LangOriginal},
		"Film.2020.German.ML.1080p.WEB.H264-GRP": {release.LangGerman, release.LangOriginal, release.LangEnglish},
		"Film.2020.TRUEFRENCH.1080p.WEB-GRP":     {release.LangFrench},
		"Film.2020.1080p.WEB.H264-GRP":           {release.LangUnknown},
	}
	for name, want := range cases {
		if got := mustParse(t, name).Languages; !reflect.DeepEqual(got, want) {
			t.Errorf("%s: languages = %v, want %v", name, got, want)
		}
	}
}

func TestHasMultipleLanguagesFindsMULTi(t *testing.T) {
	if !release.HasMultipleLanguages("Intouchables.2011.MULTi.VFF.1080p.BluRay.x264-GRP") {
		t.Error("MULTi token not found")
	}
	if release.HasMultipleLanguages("Multiplex.2011.1080p.BluRay.x264-GRP") {
		t.Error("Multiplex is not a MULTi token")
	}
}

func TestParseFlagsMultiPartMovies(t *testing.T) {
	cases := []struct {
		name string
		part int
	}{
		{"Movie.2005.CD1.DVDRip.XviD-GRP", 1},
		{"Movie.2005.CD2.DVDRip.XviD-GRP", 2},
		{"Movie.CD2.2005.DVDRip.XviD-GRP", 2},
		{"Movie.2005.Disc.2.DVDRip.XviD-GRP", 2},
		{"Movie.2005.1080p.BluRay.x264-GRP", 0},
		{"Discovery.2005.1080p.BluRay.x264-GRP", 0},
	}
	for _, c := range cases {
		p := mustParse(t, c.name)
		if p.Part != c.part || p.IsMultiPart() != (c.part > 0) {
			t.Errorf("%s: part = %d, want %d", c.name, p.Part, c.part)
		}
	}
}

func TestParseRejectsNamesThatAreNotReleases(t *testing.T) {
	for _, name := range []string{"", "0e895c37245186812cb08aab1529cf8ee389dd05", "----", "abc.xyz"} {
		if _, err := release.Parse(name, release.KindMovie); !errors.Is(err, release.ErrUnparseable) {
			t.Errorf("Parse(%q) error = %v, want ErrUnparseable", name, err)
		}
	}
}

func TestParseFolderAcceptsAYearFirstName(t *testing.T) {
	if _, err := release.Parse("(1995) Movie Name", release.KindMovie); err == nil {
		t.Error("a year-first name should not parse as a file name")
	}
	p, err := release.ParseFolder("(1995) Movie Name", release.KindMovie)
	if err != nil || p.Title() != "Movie Name" || p.Year != 1995 {
		t.Errorf("ParseFolder = %+v, %v", p, err)
	}
}

func TestParseOfAnUnsupportedKindSaysSo(t *testing.T) {
	if _, err := release.Parse("Show.S01E01.1080p.WEB-GRP", release.Kind("anime")); !errors.Is(err, release.ErrUnsupportedKind) {
		t.Errorf("error = %v, want ErrUnsupportedKind", err)
	}
}

func TestParsedReleaseRoundTripsThroughJSON(t *testing.T) {
	names := []string{
		"Movie.Hills.2019.Extended.German.DL.AC3.Dubbed.1080p.BluRay.x264-muhHD",
		"Oppenheimer.2023.REPACK.2160p.UHD.BluRay.REMUX.HDR.HEVC-GRP",
		"Movie.2005.CD2.DVDRip.XviD-GRP",
		"Movie (2005) {tmdb-12345} {imdb-tt1234567} [WEBDL-2160p]-GRP",
		"The.Movie.Name.2012.720p.BluRay.x264.KORSUB-GRP",
		"Movie.2005.TS.x264-GRP",
		"L'hypothèse.du.movie.volé.AKA.The.Hypothesis.of.the.Movie.Title.1978.1080p.CINET.WEB-DL.AAC2.0.x264-Cinefeel.mkv",
	}
	for _, name := range names {
		want := mustParse(t, name)
		data, err := json.Marshal(want)
		if err != nil {
			t.Fatal(err)
		}
		var got release.ParsedRelease
		if err := json.Unmarshal(data, &got); err != nil {
			t.Fatalf("%s: %v\n%s", name, err, data)
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%s did not round-trip\n got  %+v\n want %+v\n json %s", name, got, want, data)
		}
	}
}

func TestParsedReleaseJSONShape(t *testing.T) {
	data, err := json.Marshal(mustParse(t, "Movie.2005.1080p.BluRay.x264-GRP"))
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatal(err)
	}
	q := m["quality"].(map[string]any)["quality"].(map[string]any)
	if q["source"] != "bluray" || q["modifier"] != "none" || q["name"] != "Bluray-1080p" {
		t.Errorf("quality json = %v, want the *arr names", q)
	}
	for _, key := range []string{"kind", "titles", "year", "languages", "releaseGroup"} {
		if _, ok := m[key]; !ok {
			t.Errorf("json has no %q: %s", key, data)
		}
	}
}

func mustParseSeries(t *testing.T, name string) release.ParsedRelease {
	t.Helper()
	p, err := release.Parse(name, release.KindSeries)
	if err != nil {
		t.Fatalf("Parse(%q): %v", name, err)
	}
	return p
}

func TestParseReadsSingleAndMultiEpisodeReleases(t *testing.T) {
	single := mustParseSeries(t, "Show.Name.2016.S02E05.German.DL.1080p.WEB.h264-WvF")
	if single.Kind != release.KindSeries || single.Title() != "Show Name 2016" || single.Year != 2016 ||
		single.Series.TitleWithoutYear != "Show Name" || single.ReleaseGroup != "WvF" {
		t.Errorf("title/year/group = %q %d %q %q", single.Title(), single.Year, single.Series.TitleWithoutYear, single.ReleaseGroup)
	}
	if s := single.Series; s.Season != 2 || !reflect.DeepEqual(s.Episodes, []int{5}) || s.FullSeason {
		t.Errorf("series = %+v, want S02E05", s)
	}
	if single.SeriesReleaseType() != release.SeriesReleaseSingleEpisode {
		t.Errorf("release type = %s", single.SeriesReleaseType())
	}
	if q := single.Quality.Quality; q.Name != "WEBDL-1080p" || q.ID != 3 || q.Source != release.SourceWebDL {
		t.Errorf("quality = %+v", q)
	}
	want := []release.Language{release.LangGerman, release.LangOriginal}
	if !reflect.DeepEqual(single.Languages, want) {
		t.Errorf("languages = %v, want German and Original (the DL token)", single.Languages)
	}

	multi := mustParseSeries(t, "Show.Name.S03E01-E03.1080p.BluRay.x264-GRP")
	if s := multi.Series; s.Season != 3 || !reflect.DeepEqual(s.Episodes, []int{1, 2, 3}) {
		t.Errorf("series = %+v, want S03E01-E03", s)
	}
	if multi.SeriesReleaseType() != release.SeriesReleaseMultiEpisode {
		t.Errorf("release type = %s", multi.SeriesReleaseType())
	}
}

func TestParseReadsSeasonPacks(t *testing.T) {
	pack := mustParseSeries(t, "Show.Name.S04.2160p.WEB-DL.DDP5.1.H.265-GRP")
	if s := pack.Series; s.Season != 4 || !s.FullSeason || len(s.Episodes) != 0 || s.MultiSeason {
		t.Errorf("series = %+v, want a season 4 pack", s)
	}
	if !pack.IsSeasonPack() || pack.SeriesReleaseType() != release.SeriesReleaseSeasonPack {
		t.Errorf("not recognised as a season pack: %s", pack.SeriesReleaseType())
	}

	multi := mustParseSeries(t, "Show.Name.S01-S03.1080p.BluRay.x264-GRP")
	if s := multi.Series; s.Season != 1 || !s.FullSeason || !s.MultiSeason {
		t.Errorf("series = %+v, want a multi-season pack starting at season 1", s)
	}

	full := mustParseSeries(t, "Show Name Complete Series S01-S05 1080p BluRay x264-GRP")
	if !full.Series.FullSeason || !full.Series.MultiSeason {
		t.Errorf("series = %+v, want a full-series pack", full.Series)
	}

	part := mustParseSeries(t, "Show.Name.S02.Part.1.1080p.NF.WEBRip.DD5.1.x264-NTb")
	if s := part.Series; s.Season != 2 || !s.PartialSeason || s.SeasonPart != 1 || s.FullSeason {
		t.Errorf("series = %+v, want part 1 of season 2", s)
	}
}

func TestParseReadsDailyEpisodes(t *testing.T) {
	p := mustParseSeries(t, "The.Late.Show.2024.05.13.Guest.Name.1080p.WEB.h264-GRP")
	if !p.IsDaily() || p.Series.AirDate != "2024-05-13" || len(p.Series.Episodes) != 0 || p.Series.Season != 0 {
		t.Errorf("series = %+v, want the daily episode of 2024-05-13", p.Series)
	}
	if p.Title() != "The Late Show" {
		t.Errorf("title = %q", p.Title())
	}

	if _, err := release.Parse("Show.Name.2999.01.01.720p.HDTV.x264-GRP", release.KindSeries); !errors.Is(err, release.ErrUnparseable) {
		t.Errorf("a daily episode in the future should not parse, got %v", err)
	}
}

func TestParseFlagsAbsoluteNumberingForDecide(t *testing.T) {
	p := mustParseSeries(t, "[SubGroup] Anime Show - 105 [1080p]")
	if !p.IsAbsoluteNumbering() {
		t.Errorf("series = %+v, want absolute numbering flagged", p.Series)
	}
}

func TestSeriesQualityUsesSonarrsTable(t *testing.T) {
	remux := release.ParseQualityOf("Show.Name.S01E01.2160p.UHD.BluRay.Remux.HDR.HEVC-GRP", release.KindSeries)
	if q := remux.Quality; q.Name != "Bluray-2160p Remux" || q.ID != 21 || q.Source != release.SourceBlurayRaw {
		t.Errorf("series remux = %+v, want Sonarr's Bluray-2160p Remux", q)
	}
	movie := release.ParseQualityOf("Movie.2023.2160p.UHD.BluRay.Remux.HDR.HEVC-GRP", release.KindMovie)
	if q := movie.Quality; q.Name != "Remux-2160p" || q.ID != 31 {
		t.Errorf("movie remux = %+v, want Radarr's Remux-2160p", q)
	}
}

func TestParsePathReadsTheSeasonFromAFolder(t *testing.T) {
	p, err := release.ParsePath("/tv/Show Name (2003)/Season 3/05 - Title.mkv", release.KindSeries)
	if err != nil {
		t.Fatal(err)
	}
	if s := p.Series; s.Season != 3 || !reflect.DeepEqual(s.Episodes, []int{5}) {
		t.Errorf("series = %+v, want S03E05", s)
	}
}

func TestSeriesReleaseRoundTripsThroughJSON(t *testing.T) {
	names := []string{
		"Show.Name.2016.S02E05.German.DL.1080p.WEB.h264-WvF",
		"Show.Name.S03E01-E03.1080p.BluRay.x264-GRP",
		"Show.Name.S01-S03.1080p.BluRay.x264-GRP",
		"The.Late.Show.2024.05.13.Part.2.1080p.WEB.h264-GRP",
		"Titel.Eins / Title Two S01E02 1080p WEB-GRP",
		"Show.Name.S01E11.5.[SP].720p.HDTV.x264-GRP",
		"[SubGroup] Anime Show - 12.5 [1080p]",
	}
	for _, name := range names {
		want := mustParseSeries(t, name)
		data, err := json.Marshal(want)
		if err != nil {
			t.Fatal(err)
		}
		var got release.ParsedRelease
		if err := json.Unmarshal(data, &got); err != nil {
			t.Fatalf("%s: %v\n%s", name, err, data)
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%s did not round-trip\n got  %+v\n want %+v\n json %s", name, got.Series, want.Series, data)
		}
	}
}
