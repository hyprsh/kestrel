package scoring_test

import (
	"fmt"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
)

// matches reports whether the single Custom Format "CF" (score 1) matched the
// Release under the English HD Profile.
func matches(t testing.TB, specs []string, rel scoring.Release, title scoring.Title) bool {
	t.Helper()
	snap := newFakeSnapshot().
		cf("radarr", "cf1", "CF", `{"default":1}`, specs...).
		profile("radarr", "hd-bluray-web", "p1", "", 0, map[string]string{"CF": "cf1"}).
		load(t)
	prof, err := snap.Profile(englishHD)
	if err != nil {
		t.Fatal(err)
	}
	v := scoring.Evaluate(rel, title, prof)
	return len(v.Matched) == 1
}

func movieRelease(t testing.TB, name string) scoring.Release {
	return scoring.Release{Parsed: mustMovie(t, name)}
}

func TestConditionsOfOneTypeAreOrdedUnlessRequired(t *testing.T) {
	rel := movieRelease(t, "A.Movie.2020.1080p.WEB-DL.DD5.1.H264-GRP")
	cases := []struct {
		name  string
		specs []string
		want  bool
	}{
		{"one of several optional matches", []string{titleSpec("NOPE", false, false), titleSpec("1080p", false, false)}, true},
		{"none matches", []string{titleSpec("NOPE", false, false), titleSpec("ALSONOPE", false, false)}, false},
		{"required and matching, optional not", []string{titleSpec("1080p", false, true), titleSpec("NOPE", false, false)}, true},
		{"a required one fails", []string{titleSpec("1080p", false, true), titleSpec("NOPE", false, true), titleSpec("WEB", false, false)}, false},
		{"negated spec inverts", []string{titleSpec("NOPE", true, false)}, true},
		{"negated spec that matches fails the format", []string{titleSpec("1080p", true, false)}, false},
		{"required negation", []string{titleSpec("1080p", false, true), titleSpec("HDR", true, true)}, true},
		{"different types are ANDed", []string{titleSpec("1080p", false, false), groupSpec("OTHER", false, false)}, false},
		{"different types both match", []string{titleSpec("1080p", false, false), groupSpec("GRP", false, false)}, true},
		{"conditions are case-insensitive", []string{titleSpec("web-dl", false, false)}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := matches(t, tc.specs, rel, originalEnglish); got != tc.want {
				t.Errorf("matched = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestLookaheadRegexesWork(t *testing.T) {
	// RE2 has no lookaround; TRaSH's regexes need it.
	rel := movieRelease(t, "A.Movie.2020.1080p.BluRay.German.DL.DD5.1.x264-GRP")
	if !matches(t, []string{titleSpec(`(?<=German\.)DL(?=\.DD)`, false, false)}, rel, originalEnglish) {
		t.Error("lookbehind and lookahead regex did not match")
	}
}

func TestReleaseGroupConditionMatchesTheParsedGroupOnly(t *testing.T) {
	rel := movieRelease(t, "A.Movie.2020.1080p.WEB-DL.DD5.1.H264-GRP")
	if !matches(t, []string{groupSpec("^GRP$", false, false)}, rel, originalEnglish) {
		t.Error("group did not match")
	}
	// Radarr's group is null when the name has none, so the condition is
	// false, and its negation true.
	noGroup := movieRelease(t, "A.Movie.2020.1080p.WEB-DL.DD5.1.H264")
	if noGroup.Parsed.ReleaseGroup != "" {
		t.Skipf("parser found a group %q", noGroup.Parsed.ReleaseGroup)
	}
	if matches(t, []string{groupSpec(".*", false, false)}, noGroup, originalEnglish) {
		t.Error("a release without a group matched a group regex")
	}
	if !matches(t, []string{groupSpec("^GRP$", true, false)}, noGroup, originalEnglish) {
		t.Error("negated group condition should hold without a group")
	}
}

func TestTitleConditionAlsoTriesTheFilename(t *testing.T) {
	rel := movieRelease(t, "A.Movie.2020.1080p.WEB-DL.DD5.1.H264-GRP")
	rel.Filename = "something-REMUXED.mkv"
	if !matches(t, []string{titleSpec("REMUXED", false, false)}, rel, originalEnglish) {
		t.Error("filename was not tried")
	}
}

func fieldsSpec(impl, fields string) string { return specJSON(impl, fields, false, false) }

func TestQualityConditions(t *testing.T) {
	remux := movieRelease(t, "A.Movie.2020.1080p.BluRay.REMUX.AVC.DTS-HD.MA.5.1-GRP")
	web := movieRelease(t, "A.Movie.2020.2160p.WEB-DL.DD5.1.H265-GRP")
	cases := []struct {
		name string
		spec string
		rel  scoring.Release
		want bool
	}{
		{"source bluray (Radarr 9)", fieldsSpec("SourceSpecification", `{"value":9}`), remux, true},
		{"source webdl (Radarr 7)", fieldsSpec("SourceSpecification", `{"value":7}`), web, true},
		{"source mismatch", fieldsSpec("SourceSpecification", `{"value":7}`), remux, false},
		{"resolution 1080", fieldsSpec("ResolutionSpecification", `{"value":1080}`), remux, true},
		{"resolution 2160", fieldsSpec("ResolutionSpecification", `{"value":2160}`), remux, false},
		{"modifier remux (5)", fieldsSpec("QualityModifierSpecification", `{"value":5}`), remux, true},
		{"modifier remux on web", fieldsSpec("QualityModifierSpecification", `{"value":5}`), web, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := matches(t, []string{tc.spec}, tc.rel, originalEnglish); got != tc.want {
				t.Errorf("matched = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestIndexerFlagCondition(t *testing.T) {
	rel := movieRelease(t, "A.Movie.2020.1080p.WEB-DL.DD5.1.H264-GRP")
	scene := fieldsSpec("IndexerFlagSpecification", `{"value":128}`) // Radarr G_Scene
	freeleech := fieldsSpec("IndexerFlagSpecification", `{"value":1}`)
	if matches(t, []string{scene}, rel, originalEnglish) {
		t.Error("scene condition matched a release without the flag")
	}
	rel.IndexerFlags = scoring.FlagScene
	if !matches(t, []string{scene}, rel, originalEnglish) {
		t.Error("scene condition did not match a Scene release")
	}
	if matches(t, []string{freeleech}, rel, originalEnglish) {
		t.Error("freeleech matched on a usenet flag set")
	}
}

func TestSizeEditionAndYearConditions(t *testing.T) {
	rel := movieRelease(t, "A.Movie.2020.EXTENDED.1080p.WEB-DL.DD5.1.H264-GRP")
	rel.Size = 5 << 30
	cases := []struct {
		name string
		spec string
		want bool
	}{
		{"size inside (min exclusive, max inclusive)", fieldsSpec("SizeSpecification", `{"min":1,"max":5}`), true},
		{"size at the minimum is outside", fieldsSpec("SizeSpecification", `{"min":5,"max":10}`), false},
		{"size above the maximum", fieldsSpec("SizeSpecification", `{"min":0,"max":4}`), false},
		{"edition regex", fieldsSpec("EditionSpecification", `{"value":"extended"}`), true},
		{"edition regex miss", fieldsSpec("EditionSpecification", `{"value":"imax"}`), false},
		{"year in range", fieldsSpec("YearSpecification", `{"min":2015,"max":2020}`), true},
		{"year out of range", fieldsSpec("YearSpecification", `{"min":2021,"max":2030}`), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := matches(t, []string{tc.spec}, rel, originalEnglish); got != tc.want {
				t.Errorf("matched = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestLanguageConditions(t *testing.T) {
	german := fieldsSpec("LanguageSpecification", `{"value":4}`)
	original := fieldsSpec("LanguageSpecification", `{"value":-2}`)
	notGerman := fieldsSpec("LanguageSpecification", `{"value":4,"exceptLanguage":true}`)

	dl := movieRelease(t, "A.Movie.2020.German.DL.1080p.WEB-DL.DD5.1.H264-GRP")
	if got := dl.Parsed.Languages; len(got) != 2 {
		t.Fatalf("parser gave %v for a German DL name", got)
	}
	cases := []struct {
		name  string
		spec  string
		rel   scoring.Release
		title scoring.Title
		want  bool
	}{
		{"German condition on German DL", german, dl, originalEnglish, true},
		{"Original resolves to the Title's Original Language", original,
			dl, scoring.Title{OriginalLanguage: release.LangEnglish}, true},
		{"Original is not German for an English Title", fieldsSpec("LanguageSpecification", `{"value":-2}`),
			movieRelease(t, "A.Movie.2020.German.1080p.WEB-DL.DD5.1.H264-GRP"), originalEnglish, false},
		{"except-language holds when another language is present", notGerman, dl, originalEnglish, true},
		{"except-language on German only", notGerman,
			movieRelease(t, "A.Movie.2020.German.1080p.WEB-DL.DD5.1.H264-GRP"), originalEnglish, false},
		{"untagged release counts as the Original Language",
			fieldsSpec("LanguageSpecification", `{"value":1}`),
			movieRelease(t, "A.Movie.2020.1080p.WEB-DL.DD5.1.H264-GRP"), originalEnglish, true},
		{"untagged release is not German", german,
			movieRelease(t, "A.Movie.2020.1080p.WEB-DL.DD5.1.H264-GRP"), originalEnglish, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := matches(t, []string{tc.spec}, tc.rel, tc.title); got != tc.want {
				t.Errorf("matched = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestIndexerLanguagesWinOverParsedOnes(t *testing.T) {
	german := fieldsSpec("LanguageSpecification", `{"value":4}`)
	rel := movieRelease(t, "A.Movie.2020.1080p.WEB-DL.DD5.1.H264-GRP")
	rel.IndexerLanguages = []release.Language{release.LangGerman}
	if !matches(t, []string{german}, rel, originalEnglish) {
		t.Error("indexer-supplied German was ignored")
	}
}

func TestOriginalConditionWithUnknownOriginalLanguageMatchesNothing(t *testing.T) {
	original := fieldsSpec("LanguageSpecification", `{"value":-2}`)
	rel := movieRelease(t, "A.Movie.2020.German.DL.1080p.WEB-DL.DD5.1.H264-GRP")
	if matches(t, []string{original}, rel, scoring.Title{}) {
		t.Error("Original matched although the Title's Original Language is unknown")
	}
}

func TestSeriesCustomFormatsUseSonarrData(t *testing.T) {
	snap := newFakeSnapshot().
		cf("sonarr", "s1", "Season Pack", `{"default":10}`, fieldsSpec("ReleaseTypeSpecification", `{"value":3}`)).
		cf("sonarr", "s2", "Web", `{"default":5}`, fieldsSpec("SourceSpecification", `{"value":3}`)).
		cf("sonarr", "s3", "Bluray Raw", `{"default":1}`, fieldsSpec("SourceSpecification", `{"value":7}`)).
		cf("sonarr", "s4", "Title", `{"default":100}`, titleSpec(`^Show\.S01\.1080p`, false, false)).
		cf("radarr", "m1", "Movie Only", `{"default":1000}`, titleSpec(".", false, false)).
		profile("sonarr", "web-1080p", "sp", "", 0, map[string]string{"Season Pack": "s1", "Web": "s2", "Bluray Raw": "s3", "Title": "s4"}).
		profile("radarr", "hd-bluray-web", "p1", "", 0, map[string]string{"Movie Only": "m1"}).
		load(t)
	prof, err := snap.Profile(englishHD)
	if err != nil {
		t.Fatal(err)
	}

	// A hand-built Series ParsedRelease: the Series parser (#27) fills the
	// same fields. Sonarr matches Release Title conditions on the release title.
	parsed := release.ParsedRelease{
		Kind:         release.KindSeries,
		Titles:       []string{"Show"},
		ReleaseTitle: "Show.S01.1080p.WEB-DL.DD5.1.H264-GRP",
		Quality: release.QualityModel{Quality: release.Quality{
			Name: "WEBDL-1080p", Source: release.SourceWebDL, Resolution: 1080,
		}},
		Languages:    []release.Language{release.LangEnglish},
		ReleaseGroup: "GRP",
	}
	parsed.Series = &release.SeriesInfo{Season: 1, FullSeason: true}
	v := scoring.Evaluate(scoring.Release{Parsed: parsed}, originalEnglish, prof)
	if got, want := fmt.Sprint(matchedNames(v)), "[Season Pack Title Web]"; got != want {
		t.Errorf("matched = %s, want %s", got, want)
	}
	if v.Score != 115 {
		t.Errorf("Score = %d, want 115", v.Score)
	}
	if !v.Accepted {
		t.Errorf("rejected: %v", v.Rejections)
	}
}

func TestLoadingRejectsTheWholeSnapshotOnBadData(t *testing.T) {
	cases := []struct {
		name    string
		mutate  func(f *fakeSnapshot)
		wantErr string
	}{
		{"unknown condition type", func(f *fakeSnapshot) {
			f.cf("radarr", "x", "X", `{"default":1}`, specJSON("MysterySpecification", `{"value":1}`, false, false))
		}, "unknown condition type"},
		{"regex that does not compile", func(f *fakeSnapshot) {
			f.cf("radarr", "x", "X", `{"default":1}`, titleSpec("(unclosed", false, false))
		}, "does not compile"},
		{"missing trash_id", func(f *fakeSnapshot) {
			f.fs["radarr/cf/x.json"] = &fstest.MapFile{Data: []byte(`{"name":"X","trash_scores":{"default":1},"specifications":[` + titleSpec("a", false, false) + `]}`)}
		}, "trash_id"},
		{"no conditions", func(f *fakeSnapshot) {
			f.cf("radarr", "x", "X", `{"default":1}`)
		}, "no specifications"},
		{"Series-only condition in Radarr data", func(f *fakeSnapshot) {
			f.cf("radarr", "x", "X", `{"default":1}`, fieldsSpec("ReleaseTypeSpecification", `{"value":1}`))
		}, "unknown condition type"},
		{"profile refers to a Custom Format that is not there", func(f *fakeSnapshot) {
			f.profile("radarr", "hd-bluray-web", "p1", "", 0, map[string]string{"Ghost": "nope"})
		}, "unknown trash_id"},
		{"duplicate trash_id", func(f *fakeSnapshot) {
			f.cf("radarr", "x", "X", `{"default":1}`, titleSpec("a", false, false))
			f.cf("radarr", "y", "Y", `{"default":1}`, titleSpec("a", false, false))
			f.fs["radarr/cf/y.json"] = &fstest.MapFile{Data: []byte(strings.Replace(string(f.fs["radarr/cf/y.json"].Data), `"y"`, `"x"`, 1))}
		}, "also used"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newFakeSnapshot()
			tc.mutate(f)
			for _, app := range []string{"radarr", "sonarr"} {
				for _, dir := range []string{"cf", "cf-groups", "quality-profiles"} {
					f.fs[app+"/"+dir+"/.keep"] = &fstest.MapFile{}
				}
			}
			_, err := scoring.LoadSnapshot(f.fs)
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("LoadSnapshot error = %v, want one containing %q", err, tc.wantErr)
			}
		})
	}
}
