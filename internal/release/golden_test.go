package release

// Replays the golden /api/v3/parse answers recorded from the pinned Radarr
// container (scripts/regen-radarr-golden.sh) against Parse. Offline: no Docker,
// no Radarr.

import (
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"
)

type goldenFile struct {
	Radarr struct {
		Version     string `json:"version"`
		Commit      string `json:"commit"`
		Image       string `json:"image"`
		ImageDigest string `json:"imageDigest"`
	} `json:"radarr"`
	Cases []struct {
		Title  string        `json:"title"`
		Parsed *radarrParsed `json:"parsed"`
	} `json:"cases"`
}

// radarrParsed is the parsedMovieInfo object of Radarr's /api/v3/parse.
type radarrParsed struct {
	MovieTitles        []string     `json:"movieTitles"`
	OriginalTitle      string       `json:"originalTitle"`
	ReleaseTitle       string       `json:"releaseTitle"`
	SimpleReleaseTitle string       `json:"simpleReleaseTitle"`
	Quality            QualityModel `json:"quality"`
	Languages          []Language   `json:"languages"`
	ReleaseGroup       string       `json:"releaseGroup"`
	ReleaseHash        string       `json:"releaseHash"`
	Edition            string       `json:"edition"`
	Year               int          `json:"year"`
	ImdbID             string       `json:"imdbId"`
	TmdbID             int          `json:"tmdbId"`
	HardcodedSubs      string       `json:"hardcodedSubs"`
}

func loadGolden(t *testing.T) goldenFile {
	t.Helper()
	raw, err := os.ReadFile("testdata/golden/radarr-parse.json")
	if err != nil {
		t.Fatal(err)
	}
	var g goldenFile
	if err := json.Unmarshal(raw, &g); err != nil {
		t.Fatal(err)
	}
	return g
}

func TestGoldenRecordsThePinnedUpstream(t *testing.T) {
	g := loadGolden(t)
	if g.Radarr.Commit != UpstreamRadarr {
		t.Errorf("golden commit %s, port pinned to %s", g.Radarr.Commit, UpstreamRadarr)
	}
	if "v"+g.Radarr.Version != UpstreamRadarrVersion {
		t.Errorf("golden Radarr %s, port pinned to %s", g.Radarr.Version, UpstreamRadarrVersion)
	}
	if g.Radarr.Image == "" || !strings.HasPrefix(g.Radarr.ImageDigest, "sha256:") {
		t.Errorf("golden file must record the pinned image and digest, got %q %q", g.Radarr.Image, g.Radarr.ImageDigest)
	}
	if len(g.Cases) < 500 {
		t.Errorf("golden corpus has %d names, want a broad corpus (500+)", len(g.Cases))
	}
}

func TestGoldenParityWithRadarr(t *testing.T) {
	g := loadGolden(t)
	var german, french, unparseable int
	// The cases run as parallel subtests inside one wrapper, so the corpus
	// checks below run after every case has finished.
	t.Run("cases", func(t *testing.T) {
		for _, c := range g.Cases {
			if c.Parsed == nil {
				unparseable++
			}
			t.Run(c.Title, func(t *testing.T) {
				t.Parallel()
				got, err := Parse(c.Title, KindMovie)
				if c.Parsed == nil {
					if !errors.Is(err, ErrUnparseable) {
						t.Fatalf("Radarr cannot parse it, got %+v (err %v)", got, err)
					}
					return
				}
				if err != nil {
					t.Fatalf("Radarr parses it, got error %v", err)
				}
				want := c.Parsed
				check := func(field string, got, want any) {
					if !reflect.DeepEqual(got, want) {
						t.Errorf("%s = %#v, Radarr says %#v", field, got, want)
					}
				}
				check("titles", got.Titles, want.MovieTitles)
				check("originalTitle", got.OriginalTitle, want.OriginalTitle)
				check("releaseTitle", got.ReleaseTitle, want.ReleaseTitle)
				check("simpleReleaseTitle", got.SimpleReleaseTitle, want.SimpleReleaseTitle)
				check("quality", got.Quality.Quality, want.Quality.Quality)
				check("revision", got.Quality.Revision, want.Quality.Revision)
				check("languages", got.Languages, want.Languages)
				check("releaseGroup", got.ReleaseGroup, want.ReleaseGroup)
				check("releaseHash", got.ReleaseHash, want.ReleaseHash)
				check("edition", got.Edition, want.Edition)
				check("year", got.Year, want.Year)
				check("imdbId", got.ImdbID, want.ImdbID)
				check("tmdbId", got.TmdbID, want.TmdbID)
				check("hardcodedSubs", got.HardcodedSubs, want.HardcodedSubs)
			})
			if c.Parsed != nil {
				for _, l := range c.Parsed.Languages {
					switch l {
					case LangGerman:
						german++
					case LangFrench:
						french++
					}
				}
			}
		}
	})
	if german < 30 || french < 20 {
		t.Errorf("corpus should cover German and French names broadly, got %d German and %d French", german, french)
	}
	t.Logf("%d names, %d German, %d French, %d unparseable", len(g.Cases), german, french, unparseable)
}
