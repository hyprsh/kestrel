package release

// Sonarr's own parser fixture suites, replayed as Go table tests. The rows are
// extracted from the upstream NUnit files by scripts/portfixtures, unchanged,
// and live in testdata/sonarr (see testdata/README.md for the pinned commit).
// Every upstream test method must have a handler here or an entry in
// sonarrSkipped with a reason; a method that is neither fails the suite, so
// nothing is dropped silently.
//
// Upstream [Test] methods without rows are not extracted; they are ported by
// hand at the end of this file.

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
	"time"
)

func loadSonarrFixture(t *testing.T, name string) []fixtureCase {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "sonarr", name+".json"))
	if err != nil {
		t.Fatal(err)
	}
	var f fixtureFile
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	return f.Cases
}

const (
	absoluteReason = "anime absolute episode numbering is out of scope (PRD Release parsing, ticket #27)"
	subtitleReason = "subtitle file name parsing is out of scope"
)

// sonarrSkipped are upstream tests for behaviour Kestrel does not port, each
// with its reason. A whole fixture is skipped by listing every method of it.
var sonarrSkipped = map[string]string{
	// AbsoluteEpisodeNumberParserFixture: all absolute numbering.
	"should_handle_ambiguously_named_anime_files_in_batch_release": absoluteReason,
	"should_handle_anime_recap_numbering":                          absoluteReason,
	"should_parse_absolute_followed_by_standard_as_standard":       absoluteReason,
	"should_parse_absolute_numbers":                                absoluteReason,
	"should_parse_absolute_specials":                               absoluteReason,
	"should_parse_anime_season_packs":                              absoluteReason,
	"should_parse_multi_episode_absolute_numbers":                  absoluteReason,

	// UnicodeReleaseParserFixture: Chinese and Japanese anime releases, every
	// assertion is an absolute episode number.
	"should_parse_chinese_anime_releases":                absoluteReason,
	"should_parse_chinese_anime_season_episode_releases": absoluteReason,
	"should_parse_unbracketed_chinese_anime_releases":    absoluteReason,
	"should_parse_chinese_multiepisode_releases":         absoluteReason,
	"should_parse_gm_team_releases_and_files":            absoluteReason,
	"should_parse_unicode_digits":                        absoluteReason,
	"should_parse_false_positive_chinese_anime_releases": absoluteReason,

	"should_parse_subtitle_language_english": subtitleReason,
	"should_parse_subtitle_language_unknown": subtitleReason,
	"should_parse_title_and_tags":            subtitleReason,
	"should_not_parse_false_title":           subtitleReason,
}

func runSonarrFixture(t *testing.T, name string, handlers map[string]func(*testing.T, fixtureCase)) {
	t.Helper()
	cases := loadSonarrFixture(t, name)
	if len(cases) == 0 {
		t.Fatalf("%s has no cases", name)
	}
	for _, c := range cases {
		if _, skipped := sonarrSkipped[c.Method]; skipped {
			continue
		}
		h, ok := handlers[c.Method]
		if !ok {
			t.Errorf("%s: upstream test method %s has no Go handler and is not in sonarrSkipped", name, c.Method)
			continue
		}
		t.Run(c.name(), func(t *testing.T) { h(t, c) })
	}
}

// TestSonarrSkippedFixturesAreAccountedFor keeps the skip list honest: every
// skipped method must still exist upstream, so a stale entry is noticed.
func TestSonarrSkippedFixturesAreAccountedFor(t *testing.T) {
	seen := map[string]bool{}
	for _, f := range []string{"AbsoluteEpisodeNumberParserFixture", "UnicodeReleaseParserFixture", "LanguageParserFixture"} {
		for _, c := range loadSonarrFixture(t, f) {
			seen[c.Method] = true
		}
	}
	for m := range sonarrSkipped {
		if !seen[m] {
			t.Errorf("sonarrSkipped lists %s, which no fixture file has", m)
		}
	}
}

func mustParseSeries(t *testing.T, title string) ParsedRelease {
	t.Helper()
	p, ok := parseSeriesTitle(title)
	if !ok {
		t.Fatalf("parseSeriesTitle(%q) = unparseable", title)
	}
	return p
}

func mustParseSeriesPath(t *testing.T, path string) ParsedRelease {
	t.Helper()
	p, err := ParsePath(asOsAgnostic(path), KindSeries)
	if err != nil {
		t.Fatalf("ParsePath(%q): %v", path, err)
	}
	return p
}

// asOsAgnostic is NzbDrone.Test.Common's AsOsAgnostic on Linux: C:\ becomes
// the root and \ becomes /.
func asOsAgnostic(path string) string {
	if len(path) > 1 && path[1] == ':' {
		path = path[2:]
	}
	return strings.ReplaceAll(path, `\`, "/")
}

func (c fixtureCase) ints(i int) []int {
	var out []int
	for _, v := range c.Args[i].([]any) {
		out = append(out, int(v.(float64)))
	}
	return out
}

func equalInts(a, b []int) bool { return slices.Equal(a, b) }

func expect[T comparable](t *testing.T, what string, got, want T) {
	t.Helper()
	if got != want {
		t.Errorf("%s = %v, want %v", what, got, want)
	}
}

func expectInts(t *testing.T, what string, got, want []int) {
	t.Helper()
	if !equalInts(got, want) {
		t.Errorf("%s = %v, want %v", what, got, want)
	}
}

// sameNames reports whether two language lists hold the same languages, in any
// order (FluentAssertions' BeEquivalentTo).
func sameLanguages(got, want []Language) bool {
	if len(got) != len(want) {
		return false
	}
	for _, w := range want {
		if !hasLang(got, w) {
			return false
		}
	}
	return true
}

func TestSonarrSingleEpisodeParserFixture(t *testing.T) {
	single := func(special, split bool) func(*testing.T, fixtureCase) {
		return func(t *testing.T, c fixtureCase) {
			p := mustParseSeries(t, c.str(0))
			if len(p.Series.Episodes) != 1 {
				t.Fatalf("episodes = %v, want 1", p.Series.Episodes)
			}
			expect(t, "season", p.Series.Season, c.num(2))
			expect(t, "episode", p.Series.Episodes[0], c.num(3))
			expect(t, "series title", p.Title(), c.str(1))
			expectInts(t, "absolute episodes", p.Series.AbsoluteEpisodes, nil)
			expect(t, "full season", p.Series.FullSeason, false)
			if special {
				expect(t, "special", p.Series.Special, true)
			}
			if split {
				expect(t, "split episode", p.Series.SplitEpisode, true)
			}
		}
	}
	runSonarrFixture(t, "SingleEpisodeParserFixture", map[string]func(*testing.T, fixtureCase){
		"should_parse_single_episode":               single(false, false),
		"should_parse_japanese_variety_show_format": single(false, false),
		"should_parse_decimal_number_as_special":    single(true, false),
		"should_parse_split_episode":                single(false, true),
	})
}

func TestSonarrMultiEpisodeParserFixture(t *testing.T) {
	runSonarrFixture(t, "MultiEpisodeParserFixture", map[string]func(*testing.T, fixtureCase){
		"should_parse_multiple_episodes": func(t *testing.T, c fixtureCase) {
			p := mustParseSeries(t, c.str(0))
			expect(t, "season", p.Series.Season, c.num(2))
			expectInts(t, "episodes", p.Series.Episodes, c.ints(3))
			expect(t, "series title", p.Title(), c.str(1))
			expectInts(t, "absolute episodes", p.Series.AbsoluteEpisodes, nil)
			expect(t, "full season", p.Series.FullSeason, false)
		},
	})
}

func TestSonarrSeasonParserFixture(t *testing.T) {
	pack := func(check func(*testing.T, ParsedRelease, fixtureCase)) func(*testing.T, fixtureCase) {
		return func(t *testing.T, c fixtureCase) {
			p := mustParseSeries(t, c.str(0))
			expect(t, "season", p.Series.Season, c.num(2))
			expect(t, "series title", p.Title(), c.str(1))
			expectInts(t, "episodes", p.Series.Episodes, nil)
			expectInts(t, "absolute episodes", p.Series.AbsoluteEpisodes, nil)
			check(t, p, c)
		}
	}
	full := func(t *testing.T, p ParsedRelease, c fixtureCase) {
		expect(t, "full season", p.Series.FullSeason, true)
	}
	extras := func(t *testing.T, p ParsedRelease, c fixtureCase) {
		expect(t, "full season", p.Series.FullSeason, true)
		expect(t, "season extra", p.Series.SeasonExtra, true)
	}
	runSonarrFixture(t, "SeasonParserFixture", map[string]func(*testing.T, fixtureCase){
		"should_parse_full_season_release": pack(full),
		"should_parse_season_extras":       pack(extras),
		"should_parse_season_subpack":      pack(extras),
		"should_parse_partial_season_release": pack(func(t *testing.T, p ParsedRelease, c fixtureCase) {
			expect(t, "full season", p.Series.FullSeason, false)
			expect(t, "partial season", p.Series.PartialSeason, true)
			expect(t, "season part", p.Series.SeasonPart, c.num(3))
		}),
		"should_parse_multi_season_release": pack(func(t *testing.T, p ParsedRelease, c fixtureCase) {
			expect(t, "full season", p.Series.FullSeason, true)
			expect(t, "partial season", p.Series.PartialSeason, false)
			expect(t, "multi season", p.Series.MultiSeason, true)
		}),
	})
}

// expandDate is NzbDrone's string.Expand on the {year} {month} {day} template
// the daily tests use.
func expandDate(s string, year int, month, day string) string {
	return strings.NewReplacer("{year}", fmt.Sprint(year), "{month}", month, "{day}", day).Replace(s)
}

func TestSonarrDailyEpisodeParserFixture(t *testing.T) {
	daily := func(withPart bool) func(*testing.T, fixtureCase) {
		return func(t *testing.T, c fixtureCase) {
			p := mustParseSeries(t, c.str(0))
			want := time.Date(c.num(2), time.Month(c.num(3)), c.num(4), 0, 0, 0, 0, time.UTC).Format("2006-01-02")
			expect(t, "series title", p.Title(), c.str(1))
			expect(t, "air date", p.Series.AirDate, want)
			expectInts(t, "episodes", p.Series.Episodes, nil)
			expectInts(t, "absolute episodes", p.Series.AbsoluteEpisodes, nil)
			expect(t, "full season", p.Series.FullSeason, false)
			if withPart {
				expect(t, "daily part", p.Series.DailyPart, c.num(5))
			}
		}
	}
	unparseable := func(t *testing.T, title string) {
		t.Helper()
		if p, ok := parseSeriesTitle(title); ok {
			t.Errorf("parsed %q as %+v, want unparseable", title, p.Series)
		}
	}
	runSonarrFixture(t, "DailyEpisodeParserFixture", map[string]func(*testing.T, fixtureCase){
		"should_parse_daily_episode":                     daily(false),
		"should_parse_daily_episode_with_multiple_parts": daily(true),
		"should_not_accept_ancient_daily_series": func(t *testing.T, c fixtureCase) {
			unparseable(t, expandDate(c.str(0), 1950, "10", "14"))
		},
		"should_not_accept_future_dates": func(t *testing.T, c fixtureCase) {
			d := time.Now().AddDate(0, 0, 2)
			unparseable(t, expandDate(c.str(0), d.Year(), fmt.Sprintf("%02d", int(d.Month())), fmt.Sprintf("%02d", d.Day())))
		},
		"should_not_parse_ambiguous_daily_episode": func(t *testing.T, c fixtureCase) {
			unparseable(t, c.str(0))
		},
	})

	// should_fail_if_episode_is_far_in_future: a [Test] with no rows.
	unparseable(t, time.Now().AddDate(0, 0, 2).Format("2006.01.02")+" - A Talk Show - HD TV.mkv")
}

func TestSonarrMiniSeriesEpisodeParserFixture(t *testing.T) {
	mini := func(t *testing.T, c fixtureCase) {
		p := mustParseSeries(t, c.str(0))
		if len(p.Series.Episodes) != 1 {
			t.Fatalf("episodes = %v, want 1", p.Series.Episodes)
		}
		expect(t, "season", p.Series.Season, 1)
		expect(t, "episode", p.Series.Episodes[0], c.num(2))
		expect(t, "series title", p.Title(), c.str(1))
		expectInts(t, "absolute episodes", p.Series.AbsoluteEpisodes, nil)
		expect(t, "full season", p.Series.FullSeason, false)
		// Upstream: "We don't support both SxxExx and airdate yet", the air
		// date is not asserted.
	}
	runSonarrFixture(t, "MiniSeriesEpisodeParserFixture", map[string]func(*testing.T, fixtureCase){
		"should_parse_mini_series_episode":   mini,
		"should_parse_korean_series_episode": mini,
	})
}

func TestSonarrPathParserFixture(t *testing.T) {
	runSonarrFixture(t, "PathParserFixture", map[string]func(*testing.T, fixtureCase){
		"should_parse_from_path": func(t *testing.T, c fixtureCase) {
			p := mustParseSeriesPath(t, c.str(0))
			if len(p.Series.Episodes) != 1 {
				t.Fatalf("episodes = %v, want 1", p.Series.Episodes)
			}
			expect(t, "season", p.Series.Season, c.num(1))
			expect(t, "episode", p.Series.Episodes[0], c.num(2))
			expectInts(t, "absolute episodes", p.Series.AbsoluteEpisodes, nil)
			expect(t, "full season", p.Series.FullSeason, false)
		},
		"should_parse_multi_episode_from_path": func(t *testing.T, c fixtureCase) {
			p := mustParseSeriesPath(t, c.str(0))
			expect(t, "series title", p.Title(), c.str(1))
			expect(t, "season", p.Series.Season, c.num(2))
			expectInts(t, "episodes", p.Series.Episodes, c.ints(3))
			expectInts(t, "absolute episodes", p.Series.AbsoluteEpisodes, nil)
			expect(t, "full season", p.Series.FullSeason, false)
		},
	})
}

func TestSonarrParserFixture(t *testing.T) {
	runSonarrFixture(t, "ParserFixture", map[string]func(*testing.T, fixtureCase){
		"should_parse_series_name": func(t *testing.T, c fixtureCase) {
			got := CleanSeriesTitle(parseSeriesName(c.str(0)))
			expect(t, "cleaned series name", got, CleanSeriesTitle(c.str(1)))
		},
		"should_parse_series_title_info": func(t *testing.T, c fixtureCase) {
			p := mustParseSeries(t, c.str(0))
			year := 0
			if len(c.Args) > 2 {
				year = c.num(2)
			}
			expect(t, "title without year", p.Series.TitleWithoutYear, c.str(1))
			expect(t, "year", p.Year, year)
		},
		"should_clean_up_invalid_path_characters": func(t *testing.T, c fixtureCase) {
			_, _ = parseSeriesTitle(c.str(0)) // must not panic
		},
		"should_remove_request_info_from_title": func(t *testing.T, c fixtureCase) {
			expect(t, "series title", mustParseSeries(t, c.str(0)).Title(), c.str(1))
		},
		"should_parse_quality_from_extension": func(t *testing.T, c fixtureCase) {
			q := mustParseSeries(t, c.str(0)).Quality
			if q.Quality == sUnknown {
				t.Error("quality is Unknown")
			}
			expect(t, "source detection", q.SourceDetection, DetectedExtension)
			expect(t, "resolution detection", q.ResolutionDetection, DetectedExtension)
		},
		"should_parse_releasetitle": func(t *testing.T, c fixtureCase) {
			expect(t, "release title", mustParseSeries(t, c.str(0)).ReleaseTitle, c.str(1))
		},
		"should_parse_multiple_series_titles": func(t *testing.T, c fixtureCase) {
			var want []string
			for _, a := range c.Args[1:] {
				want = append(want, a.(string))
			}
			got := mustParseSeries(t, c.str(0)).Series.AllTitles
			slices.Sort(got)
			slices.Sort(want)
			if !slices.Equal(got, want) {
				t.Errorf("all titles = %q, want %q", got, want)
			}
		},
		"should_parse_language_after_parsing_title": func(t *testing.T, c fixtureCase) {
			langs := mustParseSeries(t, c.str(0)).Languages
			want := languageByName(t, c.str(1))
			if len(langs) != 1 || langs[0] != want {
				t.Errorf("languages = %v, want [%v]", langs, want)
			}
		},
	})

	// should_remove_accents_from_title: a [Test] with no rows.
	expect(t, "CleanSeriesTitle", CleanSeriesTitle("Seri\u00E0es"), "seriaes")
}

var allLanguages = []Language{
	LangUnknown, LangEnglish, LangFrench, LangSpanish, LangGerman, LangItalian, LangDutch,
	LangJapanese, LangChinese, LangRussian, LangPolish, LangUkrainian, LangTurkish, LangOriginal,
}

func languageByName(t *testing.T, name string) Language {
	t.Helper()
	for _, l := range allLanguages {
		if l.Name == name {
			return l
		}
	}
	t.Fatalf("no language %q", name)
	return Language{}
}

// languageMethodsSeries maps each Sonarr language fixture method to the
// languages ParseLanguages must contain.
var languageMethodsSeries = map[string][]Language{
	"should_parse_language_unknown":           {LangUnknown},
	"should_parse_language_english":           {LangEnglish},
	"should_parse_language_french":            {LangFrench},
	"should_parse_language_spanish":           {LangSpanish},
	"should_parse_language_german":            {LangGerman},
	"should_parse_language_italian":           {LangItalian},
	"should_parse_language_danish":            {LangDanish},
	"should_parse_language_dutch":             {LangDutch},
	"should_parse_language_japanese":          {LangJapanese},
	"should_parse_language_icelandic":         {LangIcelandic},
	"should_parse_language_chinese":           {LangChinese},
	"should_parse_language_korean":            {LangKorean},
	"should_parse_language_latvian":           {LangLatvian},
	"should_parse_language_russian":           {LangRussian},
	"should_parse_language_polish":            {LangPolish},
	"should_parse_language_vietnamese":        {LangVietnamese},
	"should_parse_language_swedish":           {LangSwedish},
	"should_parse_language_norwegian":         {LangNorwegian},
	"should_parse_language_finnish":           {LangFinnish},
	"should_parse_language_turkish":           {LangTurkish},
	"should_parse_language_portuguese":        {LangPortuguese},
	"should_parse_language_flemish":           {LangFlemish},
	"should_parse_language_greek":             {LangGreek},
	"should_parse_language_hungarian":         {LangHungarian},
	"should_parse_language_hebrew":            {LangHebrew},
	"should_parse_language_lithuanian":        {LangLithuanian},
	"should_parse_language_czech":             {LangCzech},
	"should_parse_language_arabic":            {LangArabic},
	"should_parse_language_hindi":             {LangHindi},
	"should_parse_language_bulgarian":         {LangBulgarian},
	"should_parse_language_malayalam":         {LangMalayalam},
	"should_parse_language_ukrainian":         {LangUkrainian},
	"should_parse_language_slovak":            {LangSlovak},
	"should_parse_language_thai":              {LangThai},
	"should_parse_language_portuguese_brazil": {LangPortugueseBR},
	"should_parse_language_spanish_latino":    {LangSpanishLatino},
	"should_parse_language_romanian":          {LangRomanian},
	"should_parse_language_catalan":           {LangCatalan},
}

func TestSonarrLanguageParserFixture(t *testing.T) {
	handlers := map[string]func(*testing.T, fixtureCase){}
	for method, want := range languageMethodsSeries {
		handlers[method] = func(t *testing.T, c fixtureCase) {
			got := parseLanguagesSeries(c.str(0))
			for _, l := range want {
				if !hasLang(got, l) {
					t.Errorf("languages = %v, want to contain %v", got, l)
				}
			}
		}
	}
	exactly := func(want ...Language) func(*testing.T, fixtureCase) {
		return func(t *testing.T, c fixtureCase) {
			if got := parseLanguagesSeries(c.str(0)); !sameLanguages(got, want) {
				t.Errorf("languages = %v, want %v", got, want)
			}
		}
	}
	// The *_with_dl_tag family runs ParseTitle upstream.
	viaTitle := func(want ...Language) func(*testing.T, fixtureCase) {
		return func(t *testing.T, c fixtureCase) {
			if got := mustParseSeries(t, c.str(0)).Languages; !sameLanguages(got, want) {
				t.Errorf("languages = %v, want %v", got, want)
			}
		}
	}
	handlers["should_parse_hindi_and_english"] = exactly(LangHindi, LangEnglish)
	handlers["should_parse_spanish_and_catalan"] = exactly(LangSpanish, LangCatalan)
	handlers["should_parse_english_spanish_and_catalan"] = exactly(LangEnglish, LangSpanish, LangCatalan)
	handlers["should_add_original_language_to_german_release_with_dl_tag"] = viaTitle(LangGerman, LangOriginal)
	handlers["should_not_add_original_language_to_german_release_when_title_contains_web_dl"] = viaTitle(LangGerman)
	handlers["should_add_original_language_and_english_to_german_release_with_ml_tag"] = viaTitle(LangGerman, LangOriginal, LangEnglish)
	handlers["should_parse_original_title_from_release_name"] = viaTitle(LangOriginal)
	handlers["should_parse_english_and_ukranian"] = viaTitle(LangUkrainian, LangEnglish)
	handlers["should_parse_turkish_and_ukranian"] = viaTitle(LangUkrainian, LangTurkish)
	runSonarrFixture(t, "LanguageParserFixture", handlers)
}

// qualityMethodsSeries maps each Sonarr quality fixture method to the quality
// ParseAndVerifyQuality expects.
var qualityMethodsSeries = map[string]Quality{
	"should_parse_sdtv_quality":              sSDTV,
	"should_parse_dvd_quality":               sDVD,
	"should_parse_webdl480p_quality":         sWEBDL480p,
	"should_parse_bluray480p_quality":        sBluray480p,
	"should_parse_webrip480p_quality":        sWEBRip480p,
	"should_parse_bluray576p_quality":        sBluray576p,
	"should_parse_hdtv720p_quality":          sHDTV720p,
	"should_parse_hdtv1080p_quality":         sHDTV1080p,
	"should_parse_hdtv2160p_quality":         sHDTV2160p,
	"should_parse_webdl720p_quality":         sWEBDL720p,
	"should_parse_webrip720p_quality":        sWEBRip720p,
	"should_parse_webdl1080p_quality":        sWEBDL1080p,
	"should_parse_webrip1080p_quality":       sWEBRip1080p,
	"should_parse_webdl2160p_quality":        sWEBDL2160p,
	"should_parse_webrip2160p_quality":       sWEBRip2160p,
	"should_parse_bluray720p_quality":        sBluray720p,
	"should_parse_bluray1080p_quality":       sBluray1080p,
	"should_parse_bluray1080p_remux_quality": sBluray1080pRemux,
	"should_parse_bluray2160p_quality":       sBluray2160p,
	"should_parse_bluray2160p_remux_quality": sBluray2160pRemux,
	"should_parse_raw_quality":               sRAWHD,
	"quality_parse":                          sUnknown,
}

var sonarrQualityIdents = map[string]Quality{
	"Quality.SDTV": sSDTV, "Quality.DVD": sDVD, "Quality.WEBDL480p": sWEBDL480p,
	"Quality.Bluray480p": sBluray480p, "Quality.Bluray576p": sBluray576p,
	"Quality.HDTV720p": sHDTV720p, "Quality.HDTV1080p": sHDTV1080p, "Quality.HDTV2160p": sHDTV2160p,
	"Quality.WEBDL720p": sWEBDL720p, "Quality.WEBDL1080p": sWEBDL1080p, "Quality.WEBDL2160p": sWEBDL2160p,
	"Quality.Bluray720p": sBluray720p, "Quality.Bluray1080p": sBluray1080p, "Quality.Bluray2160p": sBluray2160p,
	"Quality.Bluray1080pRemux": sBluray1080pRemux, "Quality.Bluray2160pRemux": sBluray2160pRemux,
}

func TestSonarrQualityParserFixture(t *testing.T) {
	verify := func(t *testing.T, title string, want Quality, proper bool) {
		t.Helper()
		got := parseQualitySeries(title)
		if got.Quality != want {
			t.Errorf("quality = %v, want %v", got.Quality, want)
		}
		version := 1
		if proper {
			version = 2
		}
		expect(t, "revision version", got.Revision.Version, version)
	}

	handlers := map[string]func(*testing.T, fixtureCase){}
	for method, want := range qualityMethodsSeries {
		handlers[method] = func(t *testing.T, c fixtureCase) { verify(t, c.str(0), want, c.boolean(1)) }
	}
	handlers["parsing_our_own_quality_enum_name"] = func(t *testing.T, c fixtureCase) {
		q := sonarrQualityIdents[c.ident(0)]
		got := parseQualitySeries(fmt.Sprintf("My series S01E01 [%s]", q.Name))
		expect(t, "quality", got.Quality, q)
	}
	handlers["should_parse_quality_from_other_source"] = func(t *testing.T, c fixtureCase) {
		for _, sep := range []string{"-", ".", " ", "_"} {
			verify(t, "My series S01E01 "+strings.ReplaceAll(c.str(0), " ", sep), sonarrQualityIdents[c.ident(1)], false)
		}
	}
	detection := func(source, resolution DetectionSource) func(*testing.T, fixtureCase) {
		return func(t *testing.T, c fixtureCase) {
			got := parseQualitySeries(c.str(0))
			expect(t, "source detection", got.SourceDetection, source)
			expect(t, "resolution detection", got.ResolutionDetection, resolution)
		}
	}
	handlers["should_parse_full_quality_from_name"] = detection(DetectedName, DetectedName)
	handlers["should_parse_resolution_from_name"] = detection(DetectedUnknown, DetectedName)
	handlers["should_parse_source_from_name"] = detection(DetectedName, DetectedUnknown)
	handlers["should_parse_quality_from_extension"] = detection(DetectedExtension, DetectedExtension)
	handlers["should_parse_resolution_from_name_and_source_from_extension"] = detection(DetectedExtension, DetectedName)
	handlers["should_be_able_to_parse_repack"] = func(t *testing.T, c fixtureCase) {
		got := parseQualitySeries(c.str(0))
		expect(t, "version", got.Revision.Version, c.num(2))
		expect(t, "repack", got.Revision.IsRepack, c.boolean(1))
	}
	handlers["should_be_able_to_parse_anime_version"] = func(t *testing.T, c fixtureCase) {
		expect(t, "version", parseQualitySeries(c.str(0)).Revision.Version, c.num(1))
	}
	runSonarrFixture(t, "QualityParserFixture", handlers)
}

func TestSonarrExtendedQualityParser(t *testing.T) {
	runSonarrFixture(t, "ExtendedQualityParserRegex", map[string]func(*testing.T, fixtureCase){
		"should_parse_reality_from_title": func(t *testing.T, c fixtureCase) {
			expect(t, "real", parseQualitySeries(c.str(0)).Revision.Real, c.num(1))
		},
		"should_parse_version_from_title": func(t *testing.T, c fixtureCase) {
			expect(t, "version", parseQualitySeries(c.str(0)).Revision.Version, c.num(1))
		},
	})
	runSonarrFixture(t, "AnimeVersionFixture", map[string]func(*testing.T, fixtureCase){
		"should_be_able_to_parse_repack": func(t *testing.T, c fixtureCase) {
			expect(t, "version", parseQualitySeries(c.str(0)).Revision.Version, c.num(1))
		},
	})
}

func TestSonarrReleaseGroupParserFixture(t *testing.T) {
	group := func(t *testing.T, c fixtureCase) {
		expect(t, "release group", parseReleaseGroupSeries(c.str(0)), c.optStr(1))
	}
	runSonarrFixture(t, "ReleaseGroupParserFixture", map[string]func(*testing.T, fixtureCase){
		"should_parse_release_group":                   group,
		"should_parse_exception_release_group":         group,
		"should_not_include_language_in_release_group": group,
		"should_not_include_repost_in_release_group":   group,
		"should_parse_anime_release_groups":            group,
		"should_not_parse_anime_hash_as_release_group": func(t *testing.T, c fixtureCase) {
			expect(t, "release group", parseReleaseGroupSeries(c.str(0)), "")
		},
	})

	// should_not_include_extension_in_release_group: a [Test] with no rows.
	expect(t, "release group",
		mustParseSeriesPath(t, `C:\Test\Doctor.Series.2005.s01e01.internal.bdrip.x264-archivist.mkv`).ReleaseGroup, "archivist")
}

func TestSonarrAnimeMetadataParserFixture(t *testing.T) {
	runSonarrFixture(t, "AnimeMetadataParserFixture", map[string]func(*testing.T, fixtureCase){
		"should_parse_releasegroup_and_hash": func(t *testing.T, c fixtureCase) {
			p := mustParseSeries(t, c.str(0))
			expect(t, "release group", p.ReleaseGroup, c.str(1))
			expect(t, "release hash", p.ReleaseHash, c.str(2))
		},
		"should_parse_release_hashes_with_10b_or_8b": func(t *testing.T, c fixtureCase) {
			expect(t, "release hash", mustParseSeries(t, c.str(0)).ReleaseHash, c.str(1))
		},
	})
}

func TestSonarrNormalizeSeriesTitleFixture(t *testing.T) {
	clean := func(t *testing.T, c fixtureCase) {
		expect(t, "CleanSeriesTitle", CleanSeriesTitle(c.str(0)), c.str(1))
	}
	forms := func(t *testing.T, formats []string, word, want string) {
		t.Helper()
		for _, f := range formats {
			expect(t, "CleanSeriesTitle("+fmt.Sprintf(f, word)+")", CleanSeriesTitle(fmt.Sprintf(f, word)), want)
		}
	}
	runSonarrFixture(t, "NormalizeSeriesTitleFixture", map[string]func(*testing.T, fixtureCase){
		"should_normalize_series_title":                              clean,
		"should_remove_special_characters_and_casing":                clean,
		"should_not_remove_from_the_beginning_of_the_title":          clean,
		"should_replace_percent_sign_with_percent_following_numbers": clean,
		"should_remove_common_words_from_middle_of_title": func(t *testing.T, c fixtureCase) {
			forms(t, []string{"word.%s.word", "word %s word", "word-%s-word"}, c.str(0), "wordword")
		},
		"should_not_remove_common_words_from_end_of_title": func(t *testing.T, c fixtureCase) {
			forms(t, []string{"word.word.%s", "word-word-%s", "word-word %s"}, c.str(0), "wordword"+strings.ToLower(c.str(0)))
		},
		"should_not_remove_common_words_in_the_middle_of_word": func(t *testing.T, c fixtureCase) {
			forms(t, []string{"word.%sword", "word %sword", "word-%sword", "word%s.word", "word%s-word", "word%s-word"},
				c.str(0), "word"+strings.ToLower(c.str(0))+"word")
		},
		"should_not_clean_word_from_beginning_of_string": func(t *testing.T, c fixtureCase) {
			forms(t, []string{"%s.word.word", "%s-word-word", "%s word word"}, c.str(0), c.str(0)+"wordword")
		},
	})

	// should_remove_a_from_middle_of_title and should_not_clean_trailing_a: [Test]s with no rows.
	forms(t, []string{"word.%s.word", "word %s word", "word-%s-word"}, "a", "wordword")
	expect(t, "CleanSeriesTitle", CleanSeriesTitle("Series Title A"), "seriestitlea")
}

func TestSonarrNormalizeEpisodeTitleFixture(t *testing.T) {
	runSonarrFixture(t, "NormalizeEpisodeTitleFixture", map[string]func(*testing.T, fixtureCase){
		"should_normalize_episode_title": func(t *testing.T, c fixtureCase) {
			expect(t, "NormalizeEpisodeTitle", NormalizeEpisodeTitle(c.str(0)), c.str(1))
		},
	})
}

func TestSonarrIsPossibleSpecialEpisodeFixture(t *testing.T) {
	special := func(want bool) func(*testing.T, fixtureCase) {
		return func(t *testing.T, c fixtureCase) {
			expect(t, "IsPossibleSpecialEpisode", mustParseSeries(t, c.str(0)).IsPossibleSpecialEpisode(), want)
		}
	}
	runSonarrFixture(t, "IsPossibleSpecialEpisodeFixture", map[string]func(*testing.T, fixtureCase){
		"IsPossibleSpecialEpisode_should_be_true":                       special(true),
		"IsPossibleSpecialEpisode_should_be_true_if_e00_special":        special(true),
		"IsPossibleSpecialEpisode_should_be_false_for_Special_in_title": special(false),
	})

	// The [Test] methods with no rows build a ParsedEpisodeInfo by hand.
	expect(t, "files without a series title are not specials",
		ParsedRelease{Series: &SeriesInfo{Season: 1, Episodes: []int{7}}}.IsPossibleSpecialEpisode(), false)
	expect(t, "no episode numbers",
		ParsedRelease{Series: &SeriesInfo{Season: 1}}.IsPossibleSpecialEpisode(), true)
}

func TestSonarrSeasonFoldersAreNotReleases(t *testing.T) {
	// should_not_parse_season_folders: a [Test] with no rows.
	if _, ok := parseSeriesTitle("Season 3"); ok {
		t.Error("a season folder parsed as a release")
	}
}

func TestSonarrSeriesTitleInfoFixture(t *testing.T) {
	// SeriesTitleInfoFixture: five [Test]s with no rows.
	noYear := mustParseSeries(t, "Series.Title.S01E01.pilot.720p.hdtv")
	expect(t, "year of a title without one", noYear.Year, 0)
	expect(t, "title without year", noYear.Series.TitleWithoutYear, noYear.Title())

	withYear := mustParseSeries(t, "Series.Title.2004.S01E01.pilot.720p.hdtv")
	expect(t, "year", withYear.Year, 2004)
	expect(t, "title", withYear.Title(), "Series Title 2004")
	expect(t, "title without year", withYear.Series.TitleWithoutYear, "Series Title")
}

func TestSonarrHashedReleaseFixture(t *testing.T) {
	runSonarrFixture(t, "HashedReleaseFixture", map[string]func(*testing.T, fixtureCase){
		"should_properly_parse_hashed_releases": func(t *testing.T, c fixtureCase) {
			p := mustParseSeriesPath(t, c.str(0))
			expect(t, "series title", p.Title(), c.str(1))
			expect(t, "quality", p.Quality.Quality, sonarrQualityIdents[c.ident(2)])
			expect(t, "release group", p.ReleaseGroup, c.optStr(3))
		},
	})
}

func TestSonarrCrapParserFixture(t *testing.T) {
	unparseable := func(t *testing.T, c fixtureCase) {
		if p, ok := parseSeriesTitle(c.str(0)); ok {
			t.Errorf("parsed %q as %q, want unparseable", c.str(0), p.Title())
		}
	}
	runSonarrFixture(t, "CrapParserFixture", map[string]func(*testing.T, fixtureCase){
		"should_not_parse_crap":                             unparseable,
		"should_not_parse_file_name_without_proper_spacing": unparseable,
		"should_not_parse_invalid_release_name":             unparseable,
		"should_not_parse_special_with_part_number":         unparseable,
		"should_not_parse_random": func(t *testing.T, c fixtureCase) {
			const charset = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
			rng := rand.New(rand.NewSource(1))
			for range 500 {
				b := make([]byte, c.num(0))
				for i := range b {
					b[i] = charset[rng.Intn(len(charset))]
				}
				if p, ok := parseSeriesTitle(string(b)); ok {
					t.Fatalf("parsed random %q as %q", b, p.Title())
				}
			}
		},
		"should_parse_unknown_formats_without_error": func(t *testing.T, c fixtureCase) {
			if _, ok := parseSeriesTitle(c.str(0)); !ok {
				t.Errorf("%q should parse", c.str(0))
			}
		},
	})

	// should_not_parse_md5: a [Test] with no rows.
	hash := []byte("CRAPPY TEST SEED")
	for range 100 {
		sum := md5.Sum(hash)
		hash = []byte(strings.ToUpper(hex.EncodeToString(sum[:])))
		if p, ok := parseSeriesTitle(string(hash)); ok {
			t.Fatalf("parsed md5 %s as %q", hash, p.Title())
		}
	}
}
