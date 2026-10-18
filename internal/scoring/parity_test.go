package scoring_test

// Replays the golden matched-Custom-Format sets recorded from pinned Radarr
// and Sonarr containers loaded with the embedded TRaSH Custom Formats
// (scripts/regen-cf-golden.sh). Offline: no Docker, no Radarr, no Sonarr.

import (
	"encoding/json"
	"github.com/hyprsh/kestrel/internal/slot"
	"os"
	"reflect"
	"slices"
	"sort"
	"testing"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
)

type cfGolden struct {
	App         string `json:"app"`
	Version     string `json:"version"`
	Image       string `json:"image"`
	ImageDigest string `json:"imageDigest"`
	TrashCommit string `json:"trashCommit"`
	Titles      []struct {
		Key              string           `json:"key"`
		Name             string           `json:"name"`
		Year             int              `json:"year"`
		OriginalLanguage release.Language `json:"originalLanguage"`
	} `json:"titles"`
	Cases []struct {
		Title     string             `json:"title"`
		Name      string             `json:"name"`
		Languages []release.Language `json:"languages"`
		Matched   []string           `json:"matched"`
		Parsed    json.RawMessage    `json:"parsed"`
	} `json:"cases"`
}

func loadCFGolden(t testing.TB, app string) cfGolden {
	t.Helper()
	raw, err := os.ReadFile("testdata/golden/" + app + "-cf.json")
	if err != nil {
		t.Fatal(err)
	}
	var g cfGolden
	if err := json.Unmarshal(raw, &g); err != nil {
		t.Fatal(err)
	}
	return g
}

func (g cfGolden) title(key string) scoring.Title {
	for _, t := range g.Titles {
		if t.Key == key {
			return scoring.Title{Name: t.Name, Year: t.Year, OriginalLanguage: t.OriginalLanguage}
		}
	}
	panic("golden title " + key)
}

func ids(ms []scoring.MatchedFormat) []string {
	out := make([]string, 0, len(ms))
	for _, m := range ms {
		out = append(out, m.TrashID)
	}
	sort.Strings(out)
	return out
}

func TestGoldenRecordsThePinnedUpstreamsAndTheSnapshot(t *testing.T) {
	for _, app := range []string{"radarr", "sonarr"} {
		g := loadCFGolden(t, app)
		if g.TrashCommit != embedded(t).Commit() {
			t.Errorf("%s golden was recorded with TRaSH %s, the embedded snapshot is %s: rerun scripts/regen-cf-golden.sh", app, g.TrashCommit, embedded(t).Commit())
		}
		if g.Image == "" || len(g.ImageDigest) < 10 {
			t.Errorf("%s golden must record the pinned image and digest", app)
		}
		if len(g.Cases) < 500 {
			t.Errorf("%s golden has %d cases, want a broad corpus", app, len(g.Cases))
		}
	}
	if g := loadCFGolden(t, "radarr"); "v"+g.Version != release.UpstreamRadarrVersion {
		t.Errorf("Radarr golden is %s, the parser port is pinned to %s", g.Version, release.UpstreamRadarrVersion)
	}
}

// Movies go through the whole chain: Kestrel's parser, then Evaluate.
func TestMovieMatchedFormatsEqualRadarrs(t *testing.T) {
	g := loadCFGolden(t, "radarr")
	snap := embedded(t)
	hd, err := snap.Profile(scoring.ProfileSpec{Slot: slot.Standard, Rule: scoring.PrimaryLanguage, Primary: release.LangGerman})
	if err != nil {
		t.Fatal(err)
	}
	// The cases run as parallel subtests inside one wrapper, so the corpus
	// checks below run after every case has finished.
	t.Run("cases", func(t *testing.T) {
		for _, c := range g.Cases {
			t.Run(c.Name, func(t *testing.T) {
				t.Parallel()
				parsed, err := release.Parse(c.Name, release.KindMovie)
				if err != nil {
					t.Fatalf("Radarr parses it, Kestrel says %v", err)
				}
				title := g.title(c.Title)
				rel := scoring.Release{Parsed: parsed}
				got := ids(snap.MatchAll(rel, title))
				if !reflect.DeepEqual(got, c.Matched) {
					t.Errorf("matched = %v\n want    %v\n(languages %v, group %q, quality %s)", names(snap, got), names(snap, c.Matched), parsed.Languages, parsed.ReleaseGroup, parsed.Quality)
				}
				if v := scoring.Evaluate(rel, title, hd); !reflect.DeepEqual(v.Languages, c.Languages) {
					t.Errorf("languages = %v, Radarr says %v", v.Languages, c.Languages)
				}
			})
		}
	})
	distinct := map[string]bool{}
	for _, c := range g.Cases {
		for _, id := range c.Matched {
			distinct[id] = true
		}
	}
	if len(distinct) < 80 {
		t.Errorf("the corpus only exercises %d distinct Custom Formats", len(distinct))
	}
}

// For each Profile, Evaluate's matched set is Radarr's matched set narrowed
// to the Profile's Custom Formats.
func TestMovieProfilesMatchRadarrsSetNarrowedToTheProfile(t *testing.T) {
	g := loadCFGolden(t, "radarr")
	snap := embedded(t)
	for _, primary := range []release.Language{release.LangEnglish, release.LangGerman, release.LangFrench} {
		for _, rule := range []scoring.LanguageRule{scoring.PrimaryLanguage, scoring.OriginalLanguage} {
			for _, sl := range []slot.Slot{slot.Standard, slot.FourK} {
				prof, err := snap.Profile(scoring.ProfileSpec{Slot: sl, Rule: rule, Primary: primary})
				if err != nil {
					t.Fatal(err)
				}
				inProfile := map[string]int{}
				for _, f := range prof.Formats(release.KindMovie) {
					inProfile[f.TrashID] = f.Score
				}
				t.Run(prof.BackingProfile(release.KindMovie), func(t *testing.T) {
					t.Parallel()
					for _, c := range g.Cases {
						parsed, err := release.Parse(c.Name, release.KindMovie)
						if err != nil {
							t.Fatal(err)
						}
						v := scoring.Evaluate(scoring.Release{Parsed: parsed}, g.title(c.Title), prof)
						var want []string
						wantScore := 0
						for _, id := range c.Matched {
							if s, ok := inProfile[id]; ok {
								want = append(want, id)
								wantScore += s
							}
						}
						if want == nil {
							want = []string{}
						}
						if got := ids(v.Matched); !reflect.DeepEqual(got, want) {
							t.Fatalf("%s: matched %v, want %v", c.Name, got, want)
						}
						if v.Score != wantScore {
							t.Fatalf("%s: Score %d, want %d", c.Name, v.Score, wantScore)
						}
					}
				})
			}
		}
	}
}

func names(snap *scoring.Snapshot, idList []string) []string {
	// A readable view of ids for failure messages.
	byID := map[string]string{}
	for _, m := range snapAll(snap) {
		byID[m.TrashID] = m.Name
	}
	out := make([]string, 0, len(idList))
	for _, id := range idList {
		if n, ok := byID[id]; ok {
			out = append(out, n)
		} else {
			out = append(out, id)
		}
	}
	return out
}

// snapAll is computed on each call: parallel subtests call names, so a
// package-level cache would be written from several goroutines.
func snapAll(snap *scoring.Snapshot) []scoring.MatchedFormat {
	var all []scoring.MatchedFormat
	for _, kind := range []release.Kind{release.KindMovie, release.KindSeries} {
		prof, err := snap.Profile(scoring.ProfileSpec{Slot: slot.Standard, Rule: scoring.PrimaryLanguage, Primary: release.LangEnglish})
		if err == nil {
			all = append(all, prof.Formats(kind)...)
		}
	}
	return all
}

// Series are checked with inputs built by hand from Sonarr's own parse of the
// name (what its Custom Formats saw), so the Custom Format engine is tested
// for Series independently of the Series parser.
func TestSeriesMatchedFormatsEqualSonarrs(t *testing.T) {
	g := loadCFGolden(t, "sonarr")
	snap := embedded(t)
	hd, err := snap.Profile(scoring.ProfileSpec{Slot: slot.Standard, Rule: scoring.PrimaryLanguage, Primary: release.LangGerman})
	if err != nil {
		t.Fatal(err)
	}
	// The cases run as parallel subtests inside one wrapper, so the corpus
	// checks below run after every case has finished.
	t.Run("cases", func(t *testing.T) {
		for _, c := range g.Cases {
			t.Run(c.Name, func(t *testing.T) {
				t.Parallel()
				rel := sonarrRelease(t, c.Parsed)
				title := g.title(c.Title)
				got := ids(snap.MatchAll(rel, title))
				if !reflect.DeepEqual(got, c.Matched) {
					t.Errorf("matched = %v\n want    %v", names(snap, got), names(snap, c.Matched))
				}
				if v := scoring.Evaluate(rel, title, hd); !reflect.DeepEqual(v.Languages, c.Languages) {
					t.Errorf("languages = %v, Sonarr says %v", v.Languages, c.Languages)
				}
			})
		}
	})
	distinct := map[string]bool{}
	for _, c := range g.Cases {
		for _, id := range c.Matched {
			distinct[id] = true
		}
	}
	if len(distinct) < 70 {
		t.Errorf("the corpus only exercises %d distinct Custom Formats", len(distinct))
	}
}

// And end to end: Kestrel's Series parser, then Evaluate.
func TestSeriesMatchedFormatsEqualSonarrsThroughTheSeriesParser(t *testing.T) {
	g := loadCFGolden(t, "sonarr")
	snap := embedded(t)
	for _, c := range g.Cases {
		t.Run(c.Name, func(t *testing.T) {
			t.Parallel()
			parsed, err := release.Parse(c.Name, release.KindSeries)
			if err != nil {
				t.Fatalf("Sonarr parses it, Kestrel says %v", err)
			}
			got := ids(snap.MatchAll(scoring.Release{Parsed: parsed}, g.title(c.Title)))
			if !reflect.DeepEqual(got, c.Matched) {
				t.Errorf("matched = %v\n want    %v\n(languages %v, group %q, quality %s)", names(snap, got), names(snap, c.Matched), parsed.Languages, parsed.ReleaseGroup, parsed.Quality)
			}
		})
	}
}

func TestSeriesProfilesMatchSonarrsSetNarrowedToTheProfile(t *testing.T) {
	g := loadCFGolden(t, "sonarr")
	snap := embedded(t)
	for _, primary := range []release.Language{release.LangEnglish, release.LangGerman, release.LangFrench} {
		for _, rule := range []scoring.LanguageRule{scoring.PrimaryLanguage, scoring.OriginalLanguage} {
			prof, err := snap.Profile(scoring.ProfileSpec{Slot: slot.Standard, Rule: rule, Primary: primary})
			if err != nil {
				t.Fatal(err)
			}
			inProfile := map[string]bool{}
			for _, f := range prof.Formats(release.KindSeries) {
				inProfile[f.TrashID] = true
			}
			t.Run(prof.BackingProfile(release.KindSeries), func(t *testing.T) {
				t.Parallel()
				for _, c := range g.Cases {
					v := scoring.Evaluate(sonarrRelease(t, c.Parsed), g.title(c.Title), prof)
					want := []string{}
					for _, id := range c.Matched {
						if inProfile[id] {
							want = append(want, id)
						}
					}
					if got := ids(v.Matched); !reflect.DeepEqual(got, want) {
						t.Fatalf("%s: matched %v, want %v", c.Name, got, want)
					}
				}
			})
		}
	}
}

// sonarrRelease builds the scoring input for a Series release from the parse
// Sonarr recorded in the golden file.
func sonarrRelease(t testing.TB, raw json.RawMessage) scoring.Release {
	t.Helper()
	var p struct {
		ReleaseTitle string `json:"releaseTitle"`
		ReleaseGroup string `json:"releaseGroup"`
		ReleaseType  string `json:"releaseType"`
		Quality      struct {
			Quality struct {
				ID         int    `json:"id"`
				Name       string `json:"name"`
				Source     string `json:"source"`
				Resolution int    `json:"resolution"`
			} `json:"quality"`
		} `json:"quality"`
		Languages []release.Language `json:"languages"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		t.Fatal(err)
	}
	sources := map[string]release.Source{
		"unknown": release.SourceUnknown, "television": release.SourceTV, "televisionRaw": release.SourceTVRaw,
		"web": release.SourceWebDL, "webRip": release.SourceWebRip, "dvd": release.SourceDVD,
		"bluray": release.SourceBluray, "blurayRaw": release.SourceBlurayRaw,
	}
	src, ok := sources[p.Quality.Quality.Source]
	if !ok {
		t.Fatalf("unknown Sonarr source %q", p.Quality.Quality.Source)
	}
	// What Sonarr called the release type, as the parsed episode numbers it
	// is derived from.
	series := map[string]*release.SeriesInfo{
		"unknown":       {Season: 1},
		"singleEpisode": {Season: 1, Episodes: []int{1}},
		"multiEpisode":  {Season: 1, Episodes: []int{1, 2}},
		"seasonPack":    {Season: 1, FullSeason: true},
	}
	info, ok := series[p.ReleaseType]
	if !ok {
		t.Fatalf("unknown Sonarr release type %q", p.ReleaseType)
	}
	return scoring.Release{
		Parsed: release.ParsedRelease{
			Kind:         release.KindSeries,
			ReleaseTitle: p.ReleaseTitle,
			ReleaseGroup: p.ReleaseGroup,
			Quality: release.QualityModel{Quality: release.Quality{
				ID: p.Quality.Quality.ID, Name: p.Quality.Quality.Name,
				Source: src, Resolution: p.Quality.Quality.Resolution,
			}},
			Languages: slices.Clone(p.Languages),
			Series:    info,
		},
	}
}
