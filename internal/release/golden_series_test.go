package release

// Replays the golden /api/v3/parse answers recorded from the pinned Sonarr
// container (scripts/regen-sonarr-golden.sh) against Parse. Offline: no Docker,
// no Sonarr.

import (
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"
)

type goldenSeriesFile struct {
	Sonarr struct {
		Version     string `json:"version"`
		Commit      string `json:"commit"`
		Image       string `json:"image"`
		ImageDigest string `json:"imageDigest"`
	} `json:"sonarr"`
	Cases []struct {
		Title  string        `json:"title"`
		Parsed *sonarrParsed `json:"parsed"`
	} `json:"cases"`
}

// sonarrParsed is the parsedEpisodeInfo object of Sonarr's /api/v3/parse.
type sonarrParsed struct {
	ReleaseTitle    string `json:"releaseTitle"`
	SeriesTitle     string `json:"seriesTitle"`
	SeriesTitleInfo struct {
		Title            string   `json:"title"`
		TitleWithoutYear string   `json:"titleWithoutYear"`
		Year             int      `json:"year"`
		AllTitles        []string `json:"allTitles"`
	} `json:"seriesTitleInfo"`
	Quality struct {
		Quality struct {
			ID         int    `json:"id"`
			Name       string `json:"name"`
			Source     string `json:"source"`
			Resolution int    `json:"resolution"`
		} `json:"quality"`
		Revision Revision `json:"revision"`
	} `json:"quality"`
	SeasonNumber                  int       `json:"seasonNumber"`
	EpisodeNumbers                []int     `json:"episodeNumbers"`
	AbsoluteEpisodeNumbers        []int     `json:"absoluteEpisodeNumbers"`
	SpecialAbsoluteEpisodeNumbers []float64 `json:"specialAbsoluteEpisodeNumbers"`
	AirDate                       string    `json:"airDate"`
	DailyPart                     int       `json:"dailyPart"`
	Languages                     []struct {
		Name string `json:"name"`
	} `json:"languages"`
	FullSeason                   bool   `json:"fullSeason"`
	IsPartialSeason              bool   `json:"isPartialSeason"`
	IsMultiSeason                bool   `json:"isMultiSeason"`
	IsSeasonExtra                bool   `json:"isSeasonExtra"`
	IsSplitEpisode               bool   `json:"isSplitEpisode"`
	IsMiniSeries                 bool   `json:"isMiniSeries"`
	Special                      bool   `json:"special"`
	ReleaseGroup                 string `json:"releaseGroup"`
	ReleaseHash                  string `json:"releaseHash"`
	SeasonPart                   int    `json:"seasonPart"`
	ReleaseTokens                string `json:"releaseTokens"`
	IsDaily                      bool   `json:"isDaily"`
	IsAbsoluteNumbering          bool   `json:"isAbsoluteNumbering"`
	IsPossibleSpecialEpisode     bool   `json:"isPossibleSpecialEpisode"`
	IsPossibleSceneSeasonSpecial bool   `json:"isPossibleSceneSeasonSpecial"`
	ReleaseType                  string `json:"releaseType"`
}

// sonarrSources maps Sonarr's QualitySource JSON names to Source.
var sonarrSources = map[string]Source{
	"unknown":       SourceUnknown,
	"television":    SourceTV,
	"televisionRaw": SourceTVRaw,
	"web":           SourceWebDL,
	"webRip":        SourceWebRip,
	"dvd":           SourceDVD,
	"bluray":        SourceBluray,
	"blurayRaw":     SourceBlurayRaw,
}

func loadGoldenSeries(t *testing.T) goldenSeriesFile {
	t.Helper()
	raw, err := os.ReadFile("testdata/golden/sonarr-parse.json")
	if err != nil {
		t.Fatal(err)
	}
	var g goldenSeriesFile
	if err := json.Unmarshal(raw, &g); err != nil {
		t.Fatal(err)
	}
	return g
}

func TestGoldenSeriesRecordsThePinnedUpstream(t *testing.T) {
	g := loadGoldenSeries(t)
	if g.Sonarr.Commit != UpstreamSonarr {
		t.Errorf("golden commit %s, port pinned to %s", g.Sonarr.Commit, UpstreamSonarr)
	}
	if "v"+g.Sonarr.Version != UpstreamSonarrVersion {
		t.Errorf("golden Sonarr %s, port pinned to %s", g.Sonarr.Version, UpstreamSonarrVersion)
	}
	if g.Sonarr.Image == "" || !strings.HasPrefix(g.Sonarr.ImageDigest, "sha256:") {
		t.Errorf("golden file must record the pinned image and digest, got %q %q", g.Sonarr.Image, g.Sonarr.ImageDigest)
	}
	if len(g.Cases) < 1000 {
		t.Errorf("golden corpus has %d names, want a broad corpus (1000+)", len(g.Cases))
	}
}

func TestGoldenSeriesParityWithSonarr(t *testing.T) {
	g := loadGoldenSeries(t)
	var packs, multi, daily, german, french, unparseable int
	for _, c := range g.Cases {
		t.Run(c.Title, func(t *testing.T) {
			got, err := Parse(c.Title, KindSeries)
			if c.Parsed == nil {
				unparseable++
				if !errors.Is(err, ErrUnparseable) {
					t.Fatalf("Sonarr cannot parse it, got %+v (err %v)", got, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("Sonarr parses it, got error %v", err)
			}
			want := c.Parsed
			s := got.Series
			check := func(field string, got, want any) {
				t.Helper()
				if !reflect.DeepEqual(got, want) {
					t.Errorf("%s = %#v, Sonarr says %#v", field, got, want)
				}
			}
			nilIfEmpty := func(v []int) []int {
				if len(v) == 0 {
					return nil
				}
				return v
			}
			check("seriesTitle", got.Title(), want.SeriesTitle)
			check("seriesTitleInfo.title", got.Title(), want.SeriesTitleInfo.Title)
			check("seriesTitleInfo.titleWithoutYear", s.TitleWithoutYear, want.SeriesTitleInfo.TitleWithoutYear)
			check("seriesTitleInfo.year", got.Year, want.SeriesTitleInfo.Year)
			check("seriesTitleInfo.allTitles", s.AllTitles, want.SeriesTitleInfo.AllTitles)
			check("releaseTitle", got.ReleaseTitle, want.ReleaseTitle)
			check("quality.id", got.Quality.Quality.ID, want.Quality.Quality.ID)
			check("quality.name", got.Quality.Quality.Name, want.Quality.Quality.Name)
			check("quality.source", got.Quality.Quality.Source, sonarrSources[want.Quality.Quality.Source])
			check("quality.resolution", got.Quality.Quality.Resolution, want.Quality.Quality.Resolution)
			check("revision", got.Quality.Revision, want.Quality.Revision)
			check("seasonNumber", s.Season, want.SeasonNumber)
			check("episodeNumbers", nilIfEmpty(s.Episodes), nilIfEmpty(want.EpisodeNumbers))
			check("absoluteEpisodeNumbers", nilIfEmpty(s.AbsoluteEpisodes), nilIfEmpty(want.AbsoluteEpisodeNumbers))
			check("specialAbsoluteEpisodeNumbers", len(s.SpecialAbsoluteEpisodes), len(want.SpecialAbsoluteEpisodeNumbers))
			check("airDate", s.AirDate, want.AirDate)
			check("dailyPart", s.DailyPart, want.DailyPart)
			var names []string
			for _, l := range got.Languages {
				names = append(names, l.Name)
			}
			var wantNames []string
			for _, l := range want.Languages {
				wantNames = append(wantNames, l.Name)
			}
			check("languages", names, wantNames)
			check("fullSeason", s.FullSeason, want.FullSeason)
			check("isPartialSeason", s.PartialSeason, want.IsPartialSeason)
			check("isMultiSeason", s.MultiSeason, want.IsMultiSeason)
			check("isSeasonExtra", s.SeasonExtra, want.IsSeasonExtra)
			check("isSplitEpisode", s.SplitEpisode, want.IsSplitEpisode)
			check("isMiniSeries", s.MiniSeries, want.IsMiniSeries)
			check("special", s.Special, want.Special)
			check("releaseGroup", got.ReleaseGroup, want.ReleaseGroup)
			check("releaseHash", got.ReleaseHash, want.ReleaseHash)
			check("seasonPart", s.SeasonPart, want.SeasonPart)
			check("releaseTokens", s.ReleaseTokens, want.ReleaseTokens)
			check("isDaily", got.IsDaily(), want.IsDaily)
			check("isAbsoluteNumbering", got.IsAbsoluteNumbering(), want.IsAbsoluteNumbering)
			check("isPossibleSpecialEpisode", got.IsPossibleSpecialEpisode(), want.IsPossibleSpecialEpisode)
			check("isPossibleSceneSeasonSpecial", got.IsPossibleSceneSeasonSpecial(), want.IsPossibleSceneSeasonSpecial)
			check("releaseType", string(got.SeriesReleaseType()), want.ReleaseType)
		})
		if p := c.Parsed; p != nil {
			switch {
			case p.FullSeason || p.IsPartialSeason:
				packs++
			case len(p.EpisodeNumbers) > 1:
				multi++
			case p.IsDaily:
				daily++
			}
			for _, l := range p.Languages {
				switch l.Name {
				case "German":
					german++
				case "French":
					french++
				}
			}
		}
	}
	if packs < 40 || multi < 30 || daily < 30 || german < 20 || french < 10 {
		t.Errorf("corpus should cover packs, multi-episode, daily, German and French names broadly, got %d packs, %d multi, %d daily, %d German, %d French", packs, multi, daily, german, french)
	}
	t.Logf("%d names, %d packs, %d multi-episode, %d daily, %d German, %d French, %d unparseable",
		len(g.Cases), packs, multi, daily, german, french, unparseable)
}
