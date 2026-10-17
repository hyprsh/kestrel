package release

// Radarr's own parser fixture suites, replayed as Go table tests. The rows are
// extracted from the upstream NUnit files by scripts/portfixtures, unchanged,
// and live in testdata/radarr (see testdata/README.md for the pinned commit).
// Every upstream test method must have a handler here or an entry in
// skippedMethods with a reason; a method that is neither fails the suite, so
// nothing is dropped silently.

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

type fixtureCase struct {
	Method      string `json:"method"`
	Args        []any  `json:"args"`
	Description string `json:"description"`
}

type fixtureFile struct {
	Fixture string        `json:"fixture"`
	Cases   []fixtureCase `json:"cases"`
}

func loadFixture(t *testing.T, name string) []fixtureCase {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "radarr", name+".json"))
	if err != nil {
		t.Fatal(err)
	}
	var f fixtureFile
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	return f.Cases
}

// skippedMethods are upstream tests for behaviour Kestrel does not port, each
// with its reason.
var skippedMethods = map[string]string{
	// Sidecar subtitle file names are not release names; Kestrel does not read them.
	"should_parse_subtitle_language_english": "subtitle file name parsing is out of scope",
	"should_parse_subtitle_language":         "subtitle file name parsing is out of scope",
	"should_parse_subtitle_language_unknown": "subtitle file name parsing is out of scope",
	"should_parse_title_and_tags":            "subtitle file name parsing is out of scope",
	"should_not_parse_false_title":           "subtitle file name parsing is out of scope",
}

func (c fixtureCase) str(i int) string {
	s, ok := c.Args[i].(string)
	if !ok {
		panic(fmt.Sprintf("%s arg %d is not a string: %v", c.Method, i, c.Args[i]))
	}
	return s
}

func (c fixtureCase) num(i int) int {
	f, ok := c.Args[i].(float64)
	if !ok {
		panic(fmt.Sprintf("%s arg %d is not a number: %v", c.Method, i, c.Args[i]))
	}
	return int(f)
}

func (c fixtureCase) boolean(i int) bool { return c.Args[i].(bool) }

// optStr returns "" for a JSON null (a C# null string).
func (c fixtureCase) optStr(i int) string {
	if c.Args[i] == nil {
		return ""
	}
	return c.str(i)
}

func (c fixtureCase) ident(i int) string { return c.Args[i].(map[string]any)["ident"].(string) }

func (c fixtureCase) strs(i int) []string {
	var out []string
	for _, v := range c.Args[i].([]any) {
		out = append(out, v.(string))
	}
	return out
}

func (c fixtureCase) name() string {
	return fmt.Sprintf("%s/%s", c.Method, strings.Join(argStrings(c.Args), "|"))
}

func argStrings(args []any) []string {
	var out []string
	for _, a := range args {
		out = append(out, fmt.Sprint(a))
	}
	if len(out) > 0 && len(out[0]) > 80 {
		out[0] = out[0][:80]
	}
	return out
}

func runFixture(t *testing.T, name string, handlers map[string]func(*testing.T, fixtureCase)) {
	t.Helper()
	cases := loadFixture(t, name)
	if len(cases) == 0 {
		t.Fatalf("%s has no cases", name)
	}
	for _, c := range cases {
		if _, skipped := skippedMethods[c.Method]; skipped {
			continue
		}
		h, ok := handlers[c.Method]
		if !ok {
			t.Errorf("%s: upstream test method %s has no Go handler and is not in skippedMethods", name, c.Method)
			continue
		}
		t.Run(c.name(), func(t *testing.T) { h(t, c) })
	}
}

func mustParseMovie(t *testing.T, title string, folder bool) ParsedRelease {
	t.Helper()
	p, ok := parseMovieTitle(title, folder)
	if !ok {
		t.Fatalf("parseMovieTitle(%q) = unparseable", title)
	}
	return p
}

func hasLang(langs []Language, want Language) bool { return slices.Contains(langs, want) }

func TestRadarrParserFixture(t *testing.T) {
	runFixture(t, "ParserFixture", map[string]func(*testing.T, fixtureCase){
		"should_parse_movie_title": func(t *testing.T, c fixtureCase) {
			if got := mustParseMovie(t, c.str(0), false).Title(); got != c.str(1) {
				t.Errorf("title = %q, want %q", got, c.str(1))
			}
		},
		"should_parse_anime_movie_title": func(t *testing.T, c fixtureCase) {
			p := mustParseMovie(t, c.str(0), false)
			if p.Title() != c.str(1) || p.ReleaseGroup != c.str(2) || p.Year != c.num(3) {
				t.Errorf("got title %q group %q year %d, want %q %q %d", p.Title(), p.ReleaseGroup, p.Year, c.str(1), c.str(2), c.num(3))
			}
		},
		"should_parse_anime_movie_title_without_year": func(t *testing.T, c fixtureCase) {
			p := mustParseMovie(t, c.str(0), false)
			if p.Title() != c.str(1) || p.ReleaseGroup != c.str(2) {
				t.Errorf("got title %q group %q, want %q %q", p.Title(), p.ReleaseGroup, c.str(1), c.str(2))
			}
		},
		"should_parse_german_movie": func(t *testing.T, c fixtureCase) {
			p := mustParseMovie(t, c.str(0), false)
			if p.Title() != c.str(1) || p.Edition != c.str(2) || p.Year != c.num(3) {
				t.Errorf("got title %q edition %q year %d, want %q %q %d", p.Title(), p.Edition, p.Year, c.str(1), c.str(2), c.num(3))
			}
		},
		"should_parse_movie_alternative_titles": func(t *testing.T, c fixtureCase) {
			p := mustParseMovie(t, c.str(0), true)
			if want := c.strs(1); !slices.Equal(p.Titles, want) {
				t.Errorf("titles = %q, want %q", p.Titles, want)
			}
		},
		"should_parse_movie_folder_name": func(t *testing.T, c fixtureCase) {
			if got := mustParseMovie(t, c.str(0), true).Title(); got != c.str(1) {
				t.Errorf("title = %q, want %q", got, c.str(1))
			}
		},
		"should_parse_movie_year": func(t *testing.T, c fixtureCase) {
			if got := mustParseMovie(t, c.str(0), false).Year; got != c.num(1) {
				t.Errorf("year = %d, want %d", got, c.num(1))
			}
		},
		"should_parse_tmdb_id": func(t *testing.T, c fixtureCase) {
			if got := mustParseMovie(t, c.str(0), false).TmdbID; got != c.num(1) {
				t.Errorf("tmdb id = %d, want %d", got, c.num(1))
			}
		},
		"should_not_parse_wrong_language_in_title": func(t *testing.T, c fixtureCase) {
			langs := mustParseMovie(t, c.str(0), true).Languages
			if len(langs) != 1 || langs[0] != LangUnknown {
				t.Errorf("languages = %v, want [Unknown]", langs)
			}
		},
		"should_parse_hardcoded_subs": func(t *testing.T, c fixtureCase) {
			if got := mustParseMovie(t, c.str(0), false).HardcodedSubs; got != c.optStr(1) {
				t.Errorf("hardcoded subs = %q, want %q", got, c.optStr(1))
			}
		},
		"should_parse_imdb_in_title": func(t *testing.T, c fixtureCase) {
			if got := mustParseMovie(t, c.str(0), true).ImdbID; got != c.str(1) {
				t.Errorf("imdb id = %q, want %q", got, c.str(1))
			}
		},
		"should_normalize_imdbid": func(t *testing.T, c fixtureCase) {
			if got := NormalizeImdbID(c.str(0)); got != c.optStr(1) {
				t.Errorf("NormalizeImdbID = %q, want %q", got, c.optStr(1))
			}
		},
	})
}

func TestRadarrCleanMovieTitle(t *testing.T) {
	// should_remove_accents_from_title: a [Test] with no rows upstream.
	if got := CleanMovieTitle("Carniv\u00E0le"); got != "carnivale" {
		t.Errorf("CleanMovieTitle = %q, want carnivale", got)
	}
}

// languageMethods maps each language fixture method to the languages the
// release must contain and the way upstream parses it: "folder" and "title"
// run ParseMovieTitle (isDir true or false), "languages" runs ParseLanguages.
var languageMethods = map[string]struct {
	langs []Language
	mode  string
}{
	"should_parse_language_english":              {[]Language{LangEnglish}, "folder"},
	"should_parse_language_unknown":              {[]Language{LangUnknown}, "folder"},
	"should_parse_language_french":               {[]Language{LangFrench}, "folder"},
	"should_parse_language_french_english":       {[]Language{LangFrench, LangEnglish}, "folder"},
	"should_parse_language_spanish":              {[]Language{LangSpanish}, "folder"},
	"should_parse_language_german":               {[]Language{LangGerman}, "folder"},
	"should_parse_language_italian":              {[]Language{LangItalian}, "folder"},
	"should_parse_language_danish":               {[]Language{LangDanish}, "folder"},
	"should_parse_language_dutch":                {[]Language{LangDutch}, "folder"},
	"should_parse_language_japanese":             {[]Language{LangJapanese}, "folder"},
	"should_parse_language_icelandic":            {[]Language{LangIcelandic}, "folder"},
	"should_parse_language_chinese":              {[]Language{LangChinese}, "folder"},
	"should_parse_language_russian":              {[]Language{LangRussian}, "folder"},
	"should_parse_language_romanian":             {[]Language{LangRomanian}, "folder"},
	"should_parse_language_hindi":                {[]Language{LangHindi}, "folder"},
	"should_parse_language_thai":                 {[]Language{LangThai}, "folder"},
	"should_parse_language_bulgarian":            {[]Language{LangBulgarian}, "folder"},
	"should_parse_language_brazilian_portuguese": {[]Language{LangPortugueseBR}, "folder"},
	"should_parse_language_polish":               {[]Language{LangPolish}, "folder"},
	"should_parse_language_polish_subbed":        {[]Language{LangUnknown}, "folder"},
	"should_parse_language_vietnamese":           {[]Language{LangVietnamese}, "folder"},
	"should_parse_language_swedish":              {[]Language{LangSwedish}, "folder"},
	"should_parse_language_norwegian":            {[]Language{LangNorwegian}, "folder"},
	"should_parse_language_finnish":              {[]Language{LangFinnish}, "folder"},
	"should_parse_language_turkish":              {[]Language{LangTurkish}, "folder"},
	"should_parse_language_portuguese":           {[]Language{LangPortuguese}, "folder"},
	"should_parse_language_flemish":              {[]Language{LangFlemish}, "folder"},
	"should_parse_language_greek":                {[]Language{LangGreek}, "folder"},
	"should_parse_language_korean":               {[]Language{LangKorean}, "folder"},
	"should_parse_language_hungarian":            {[]Language{LangHungarian}, "folder"},
	"should_parse_language_hebrew":               {[]Language{LangHebrew}, "folder"},
	"should_parse_language_lithuanian":           {[]Language{LangLithuanian}, "folder"},
	"should_parse_language_czech":                {[]Language{LangCzech}, "folder"},
	"should_parse_language_arabic":               {[]Language{LangArabic}, "title"},
	"should_parse_language_ukrainian":            {[]Language{LangUkrainian}, "folder"},
	"should_parse_language_ukrainian_multi":      {[]Language{LangUkrainian}, "folder"},
	"should_parse_language_persian":              {[]Language{LangPersian}, "title"},
	"should_parse_language_bengali":              {[]Language{LangBengali}, "title"},
	"should_parse_language_telugu":               {[]Language{LangTelugu}, "title"},
	"should_parse_language_slovak":               {[]Language{LangSlovak}, "title"},
	"should_parse_language_latvian":              {[]Language{LangLatvian}, "title"},
	"should_parse_language_catalan":              {[]Language{LangCatalan}, "folder"},
	"should_parse_language_malayalam":            {[]Language{LangMalayalam}, "languages"},
	"should_parse_language_kannada":              {[]Language{LangKannada}, "languages"},
	"should_parse_language_albanian":             {[]Language{LangAlbanian}, "languages"},
	"should_parse_language_afrikaans":            {[]Language{LangAfrikaans}, "languages"},
	"should_parse_language_marathi":              {[]Language{LangMarathi}, "languages"},
	"should_parse_language_tagalog":              {[]Language{LangTagalog}, "languages"},
	"should_parse_language_urdu":                 {[]Language{LangUrdu}, "languages"},
	"should_parse_language_romansh":              {[]Language{LangRomansh}, "languages"},
	"should_parse_language_mongolian":            {[]Language{LangMongolian}, "languages"},
	"should_parse_language_georgian":             {[]Language{LangGeorgian}, "languages"},
}

func TestRadarrLanguageParserFixture(t *testing.T) {
	handlers := map[string]func(*testing.T, fixtureCase){
		"should_parse_language_spanish_latino": func(t *testing.T, c fixtureCase) {
			langs := ParseLanguages(c.str(0))
			if langs[0].ID != LangSpanishLatino.ID {
				t.Errorf("first language = %v, want Spanish (Latino)", langs[0])
			}
		},
		"should_add_original_language_to_german_release_with_dl_tag": func(t *testing.T, c fixtureCase) {
			if got := mustParseMovie(t, c.str(0), false).Languages; len(got) != 2 {
				t.Errorf("languages = %v, want 2", got)
			}
		},
		"should_not_add_original_language_to_german_release_when_title_contains_web_dl": func(t *testing.T, c fixtureCase) {
			if got := mustParseMovie(t, c.str(0), false).Languages; len(got) != 1 {
				t.Errorf("languages = %v, want 1", got)
			}
		},
		"should_parse_original_title_from_release_name": func(t *testing.T, c fixtureCase) {
			got := mustParseMovie(t, c.str(0), false).Languages
			if len(got) != 1 || !hasLang(got, LangOriginal) {
				t.Errorf("languages = %v, want [Original]", got)
			}
		},
		"should_add_original_language_and_english_to_german_release_with_ml_tag": func(t *testing.T, c fixtureCase) {
			if got := mustParseMovie(t, c.str(0), false).Languages; len(got) != 3 {
				t.Errorf("languages = %v, want 3", got)
			}
		},
	}
	for method, spec := range languageMethods {
		handlers[method] = func(t *testing.T, c fixtureCase) {
			var got []Language
			switch spec.mode {
			case "languages":
				got = ParseLanguages(c.str(0))
			case "title":
				got = mustParseMovie(t, c.str(0), false).Languages
			default:
				got = mustParseMovie(t, c.str(0), true).Languages
			}
			for _, want := range spec.langs {
				if !hasLang(got, want) {
					t.Errorf("languages = %v, want to contain %v", got, want)
				}
			}
		}
	}
	runFixture(t, "LanguageParserFixture", handlers)
}

// qualityMethods maps each quality fixture method to the source, resolution and
// modifier ParseAndVerifyQuality expects. A zero resolution is not checked.
var qualityMethods = map[string]struct {
	source     Source
	resolution Resolution
	modifier   Modifier
	noProper   bool // the method has no proper argument; the version is always 1
}{
	"should_parse_ts":                              {SourceTelesync, Res720p, ModifierNone, false},
	"should_parse_cam":                             {SourceCAM, ResolutionUnknown, ModifierNone, false},
	"should_parse_sdtv_quality":                    {SourceTV, Res480p, ModifierNone, false},
	"should_parse_dvd_quality":                     {SourceDVD, ResolutionUnknown, ModifierNone, false},
	"should_parse_dvdr_quality":                    {SourceDVD, Res480p, ModifierRemux, false},
	"should_parse_webdl480p_quality":               {SourceWebDL, Res480p, ModifierNone, false},
	"should_parse_webrip480p_quality":              {SourceWebRip, Res480p, ModifierNone, false},
	"should_parse_bluray480p_quality":              {SourceBluray, Res480p, ModifierNone, false},
	"should_parse_hdtv720p_quality":                {SourceTV, Res720p, ModifierNone, false},
	"should_parse_hdtv1080p_quality":               {SourceTV, Res1080p, ModifierNone, false},
	"should_parse_hdtv2160p_quality":               {SourceTV, Res2160p, ModifierNone, false},
	"should_parse_webdl720p_quality":               {SourceWebDL, Res720p, ModifierNone, false},
	"should_parse_webrip720p_quality":              {SourceWebRip, Res720p, ModifierNone, false},
	"should_parse_webdl1080p_quality":              {SourceWebDL, Res1080p, ModifierNone, false},
	"should_parse_webrip1080p_quality":             {SourceWebRip, Res1080p, ModifierNone, false},
	"should_parse_webdl2160p_quality":              {SourceWebDL, Res2160p, ModifierNone, false},
	"should_parse_webrip2160p_quality":             {SourceWebRip, Res2160p, ModifierNone, false},
	"should_parse_bluray720p_quality":              {SourceBluray, Res720p, ModifierNone, false},
	"should_parse_bluray1080p_quality":             {SourceBluray, Res1080p, ModifierNone, false},
	"should_parse_bluray2160p_quality":             {SourceBluray, Res2160p, ModifierNone, false},
	"should_parse_bluray576p_quality":              {SourceBluray, Res576p, ModifierNone, true},
	"should_parse_remux720p_as_bluray720p_quality": {SourceBluray, Res720p, ModifierNone, true},
	"should_parse_remux1080p_quality":              {SourceBluray, Res1080p, ModifierRemux, true},
	"should_parse_remux2160p_quality":              {SourceBluray, Res2160p, ModifierRemux, true},
	"should_parse_brdisk_1080p_quality":            {SourceBluray, Res1080p, ModifierBRDisk, true},
	"should_parse_raw_quality":                     {SourceTV, Res1080p, ModifierRawHD, false},
	"quality_parse":                                {SourceUnknown, ResolutionUnknown, ModifierNone, false},
}

func verifyQuality(t *testing.T, title string, source Source, proper bool, resolution Resolution, modifier Modifier) {
	t.Helper()
	got := ParseQuality(title)
	if resolution != ResolutionUnknown && got.Quality.Resolution != int(resolution) {
		t.Errorf("resolution = %d, want %d (%s)", got.Quality.Resolution, resolution, got)
	}
	if got.Quality.Source != source {
		t.Errorf("source = %v, want %v (%s)", got.Quality.Source, source, got)
	}
	if modifier != ModifierNone && got.Quality.Modifier != modifier {
		t.Errorf("modifier = %v, want %v (%s)", got.Quality.Modifier, modifier, got)
	}
	version := 1
	if proper {
		version = 2
	}
	if got.Revision.Version != version {
		t.Errorf("version = %d, want %d (%s)", got.Revision.Version, version, got)
	}
}

var sourceIdents = map[string]Source{
	"QualitySource.TV": SourceTV, "QualitySource.DVD": SourceDVD, "QualitySource.WEBDL": SourceWebDL,
	"QualitySource.BLURAY": SourceBluray,
}
var resolutionIdents = map[string]Resolution{
	"Resolution.Unknown": ResolutionUnknown, "Resolution.R480p": Res480p, "Resolution.R720p": Res720p,
	"Resolution.R1080p": Res1080p, "Resolution.R2160p": Res2160p,
}
var modifierIdents = map[string]Modifier{"Modifier.NONE": ModifierNone, "Modifier.REMUX": ModifierRemux}

func TestRadarrQualityParserFixture(t *testing.T) {
	handlers := map[string]func(*testing.T, fixtureCase){
		"should_parse_quality_from_other_source": func(t *testing.T, c fixtureCase) {
			source, res, mod := sourceIdents[c.ident(1)], resolutionIdents[c.ident(2)], ModifierNone
			if len(c.Args) > 3 {
				mod = modifierIdents[c.ident(3)]
			}
			for _, sep := range []string{"-", ".", " ", "_"} {
				title := "My series S01E01 " + strings.ReplaceAll(c.str(0), " ", sep)
				verifyQuality(t, title, source, false, res, mod)
			}
		},
		"should_parse_full_quality_from_name": func(t *testing.T, c fixtureCase) {
			got := ParseQuality(c.str(0))
			if got.SourceDetection != DetectedName || got.ResolutionDetection != DetectedName {
				t.Errorf("detection = %v/%v, want name/name", got.SourceDetection, got.ResolutionDetection)
			}
		},
		"should_parse_resolution_from_name": func(t *testing.T, c fixtureCase) {
			got := ParseQuality(c.str(0))
			if got.SourceDetection != DetectedUnknown || got.ResolutionDetection != DetectedName {
				t.Errorf("detection = %v/%v, want unknown/name", got.SourceDetection, got.ResolutionDetection)
			}
		},
		"should_parse_source_from_name": func(t *testing.T, c fixtureCase) {
			got := ParseQuality(c.str(0))
			if got.SourceDetection != DetectedName || got.ResolutionDetection != DetectedUnknown {
				t.Errorf("detection = %v/%v, want name/unknown", got.SourceDetection, got.ResolutionDetection)
			}
		},
		"should_parse_quality_from_extension": func(t *testing.T, c fixtureCase) {
			got := ParseQuality(c.str(0))
			if got.SourceDetection != DetectedExtension || got.ResolutionDetection != DetectedExtension {
				t.Errorf("detection = %v/%v, want extension/extension", got.SourceDetection, got.ResolutionDetection)
			}
		},
		"should_parse_resolution_from_name_and_source_from_extension": func(t *testing.T, c fixtureCase) {
			got := ParseQuality(c.str(0))
			if got.SourceDetection != DetectedExtension || got.ResolutionDetection != DetectedName {
				t.Errorf("detection = %v/%v, want extension/name", got.SourceDetection, got.ResolutionDetection)
			}
		},
		"should_be_able_to_parse_repack": func(t *testing.T, c fixtureCase) {
			got := ParseQuality(c.str(0))
			if got.Revision.Version != c.num(2) || got.Revision.IsRepack != c.boolean(1) {
				t.Errorf("revision = %+v, want version %d repack %v", got.Revision, c.num(2), c.boolean(1))
			}
		},
	}
	for method, spec := range qualityMethods {
		handlers[method] = func(t *testing.T, c fixtureCase) {
			proper := !spec.noProper && c.boolean(1)
			verifyQuality(t, c.str(0), spec.source, proper, spec.resolution, spec.modifier)
		}
	}
	runFixture(t, "QualityParserFixture", handlers)
}

func TestRadarrExtendedQualityParser(t *testing.T) {
	runFixture(t, "ExtendedQualityParserRegex", map[string]func(*testing.T, fixtureCase){
		"should_parse_reality_from_title": func(t *testing.T, c fixtureCase) {
			if got := ParseQuality(c.str(0)).Revision.Real; got != c.num(1) {
				t.Errorf("real = %d, want %d", got, c.num(1))
			}
		},
		"should_parse_version_from_title": func(t *testing.T, c fixtureCase) {
			if got := ParseQuality(c.str(0)).Revision.Version; got != c.num(1) {
				t.Errorf("version = %d, want %d", got, c.num(1))
			}
		},
		"should_parse_ultrahd_from_title": func(t *testing.T, c fixtureCase) {
			if got := ParseQuality(c.str(0)).Quality.Resolution; got != int(Res2160p) {
				t.Errorf("resolution = %d, want 2160", got)
			}
		},
	})
}

func TestRadarrReleaseGroupParserFixture(t *testing.T) {
	check := func(t *testing.T, c fixtureCase) {
		if got := ParseReleaseGroup(c.str(0)); got != c.optStr(1) {
			t.Errorf("group = %q, want %q", got, c.optStr(1))
		}
	}
	runFixture(t, "ReleaseGroupParserFixture", map[string]func(*testing.T, fixtureCase){
		"should_parse_release_group":                     check,
		"should_parse_exception_release_group":           check,
		"should_not_include_extension_in_release_group":  check,
		"should_not_include_language_in_release_group":   check,
		"should_not_include_bad_suffix_in_release_group": check,
		"should_parse_anime_release_groups":              check,
		"should_not_parse_anime_hash_as_release_group": func(t *testing.T, c fixtureCase) {
			if got := ParseReleaseGroup(c.str(0)); got != "" {
				t.Errorf("group = %q, want none", got)
			}
		},
	})
}

func TestRadarrEditionParserFixture(t *testing.T) {
	runFixture(t, "EditionParserFixture", map[string]func(*testing.T, fixtureCase){
		"should_parse_edition": func(t *testing.T, c fixtureCase) {
			if got := mustParseMovie(t, c.str(0), false).Edition; got != c.str(1) {
				t.Errorf("edition = %q, want %q", got, c.str(1))
			}
		},
		"should_not_parse_edition": func(t *testing.T, c fixtureCase) {
			if got := mustParseMovie(t, c.str(0), false).Edition; got != "" {
				t.Errorf("edition = %q, want none", got)
			}
		},
	})
}

func TestRadarrNormalizeTitleFixture(t *testing.T) {
	equal := func(t *testing.T, got, want string) {
		t.Helper()
		if got != want {
			t.Errorf("CleanMovieTitle = %q, want %q", got, want)
		}
	}
	clean := func(t *testing.T, c fixtureCase) { equal(t, CleanMovieTitle(c.str(0)), c.str(1)) }
	forms := func(t *testing.T, formats []string, word string, want string) {
		for _, f := range formats {
			equal(t, CleanMovieTitle(strings.ReplaceAll(f, "{0}", word)), want)
		}
	}
	runFixture(t, "NormalizeTitleFixture", map[string]func(*testing.T, fixtureCase){
		"should_normalize_series_title":                     clean,
		"should_remove_special_characters_and_casing":       clean,
		"should_not_remove_from_the_beginning_of_the_title": clean,
		"should_remove_common_words_from_middle_of_title": func(t *testing.T, c fixtureCase) {
			forms(t, []string{"word.{0}.word", "word {0} word", "word-{0}-word"}, c.str(0), "wordword")
		},
		"should_not_remove_common_words_from_end_of_title": func(t *testing.T, c fixtureCase) {
			forms(t, []string{"word.word.{0}", "word-word-{0}", "word-word {0}"}, c.str(0), "wordword"+strings.ToLower(c.str(0)))
		},
		"should_not_remove_common_words_in_the_middle_of_word": func(t *testing.T, c fixtureCase) {
			forms(t, []string{"word.{0}word", "word {0}word", "word-{0}word", "word{0}.word", "word{0}-word", "word{0}-word"},
				c.str(0), "word"+strings.ToLower(c.str(0))+"word")
		},
		"should_not_clean_word_from_beginning_of_string": func(t *testing.T, c fixtureCase) {
			forms(t, []string{"{0}.word.word", "{0}-word-word", "{0} word word"}, c.str(0), c.str(0)+"wordword")
		},
	})

	// The [Test] methods without rows.
	forms(t, []string{"word.{0}.word", "word {0} word", "word-{0}-word"}, "a", "wordword")
	forms(t, []string{"word.{0}.N.K.L.E.word", "word {0} N K L E word", "word-{0}-N-K-L-E-word"}, "a", "wordankleword")
	forms(t, []string{"word.N.K.L.E.{0}.word", "word N K L E {0} word", "word-N-K-L-E-{0}-word"}, "a", "wordnkleaword")
	equal(t, CleanMovieTitle("Tokyo Ghoul A"), "tokyoghoula")
}

func TestRadarrHashedReleaseFixture(t *testing.T) {
	qualityByName := map[string]Quality{
		"Quality.WEBDL720p": qWEBDL720p, "Quality.Bluray1080p": qBluray1080p, "Quality.DVD": qDVD,
		"Quality.HDTV720p": qHDTV720p, "Quality.WEBDL1080p": qWEBDL1080p,
	}
	runFixture(t, "HashedReleaseFixture", map[string]func(*testing.T, fixtureCase){
		"should_properly_parse_hashed_releases": func(t *testing.T, c fixtureCase) {
			// AsOsAgnostic: C:\ becomes the root and \ becomes /.
			path := strings.ReplaceAll(strings.TrimPrefix(c.str(0), "C:"), `\`, "/")
			p, err := ParsePath(path, KindMovie)
			if err != nil {
				t.Fatal(err)
			}
			if p.Title() != c.str(1) {
				t.Errorf("title = %q, want %q", p.Title(), c.str(1))
			}
			if want := qualityByName[c.ident(2)]; p.Quality.Quality != want {
				t.Errorf("quality = %v, want %v", p.Quality.Quality, want)
			}
			if p.ReleaseGroup != c.optStr(3) {
				t.Errorf("group = %q, want %q", p.ReleaseGroup, c.optStr(3))
			}
		},
	})
}

func TestRadarrCrapParserFixture(t *testing.T) {
	unparseable := func(t *testing.T, c fixtureCase) {
		if p, ok := parseMovieTitle(c.str(0), false); ok {
			t.Errorf("parsed %q as %q, want unparseable", c.str(0), p.Title())
		}
	}
	runFixture(t, "CrapParserFixture", map[string]func(*testing.T, fixtureCase){
		"should_not_parse_crap":                             unparseable,
		"should_not_parse_file_name_without_proper_spacing": unparseable,
		"should_not_parse_invalid_release_name":             unparseable,
		"should_not_parse_random": func(t *testing.T, c fixtureCase) {
			const charset = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
			rng := rand.New(rand.NewSource(1))
			for range 500 {
				b := make([]byte, c.num(0))
				for i := range b {
					b[i] = charset[rng.Intn(len(charset))]
				}
				if p, ok := parseMovieTitle(string(b), false); ok {
					t.Fatalf("parsed random %q as %q", b, p.Title())
				}
			}
		},
	})

	// should_not_parse_md5: a [Test] with no rows.
	hash := []byte("CRAPPY TEST SEED")
	for range 100 {
		sum := md5.Sum(hash)
		hash = []byte(strings.ToUpper(hex.EncodeToString(sum[:])))
		if p, ok := parseMovieTitle(string(hash), false); ok {
			t.Fatalf("parsed md5 %s as %q", hash, p.Title())
		}
	}
}
