package release

// Ported from Sonarr v4.0.20.3014 (cab419ade8ac7fcab5bf80394ee492abd35d5f5a):
// src/NzbDrone.Core/Parser/LanguageParser.cs (ParseLanguages; the subtitle file
// parsers are not part of release name parsing). Sonarr is GPL-3.0, like
// Kestrel.
//
// Sonarr numbers its languages differently from Radarr, past id 25. Kestrel has
// one language table, the one in language.go, so the languages found here are
// the shared values; compare languages by name when checking against Sonarr.

import (
	"strings"

	"github.com/dlclark/regexp2"
)

var (
	cleanSeriesTitleLangRegex = ci(`.*?[_. ](S\d{2}(?:E\d{2,4})*[_. ].*)`)

	languageRegexSeries = ci(`(?:\W|_)(?<english>\b(?:ing|eng)\b)|(?<italian>\b(?:ita|italian)\b)|(?<german>german\b|videomann|ger[. ]dub)|(?<flemish>flemish)|(?<greek>greek)|(?<french>(?:\W|_)(?:FR|VF|VF2|VFF|VFI|VFQ|TRUEFRENCH|FRENCH)(?:\W|_))|(?<russian>\b(?:rus|ru)\b)|(?<hungarian>\b(?:HUNDUB|HUN)\b)|(?<hebrew>\bHebDub\b)|(?<polish>\b(?:PL\W?DUB|DUB\W?PL|LEK\W?PL|PL\W?LEK)\b)|(?<chinese>\[(?:CH[ST]|BIG5|GB)\]|简|繁|字幕)|(?<bulgarian>\bbgaudio\b)|(?<spanish>\b(?:español|castellano|esp|spa(?!\(Latino\)))\b)|(?<ukrainian>\b(?:\dx?)?(?:ukr))|(?<thai>\b(?:THAI)\b)|(?<romanian>\b(?:RoDubbed|ROMANIAN)\b)|(?<catalan>[-,. ]cat[. ](?:DD|subs)|\b(?:catalan|catalán)\b)|(?<latvian>\b(?:lat|lav|lv)\b)|(?<turkish>\b(?:tur)\b)|(?<original>\b(?:orig|original)\b)`)

	caseSensitiveLanguageRegexSeries = mustRx(`(?:(?i)(?<!SUB[\W|_|^]))(?:(?<lithuanian>\bLT\b)|(?<czech>\bCZ\b)|(?<polish>\bPL\b)|(?<bulgarian>\bBG\b)|(?<slovak>\bSK\b))(?:(?i)(?![\W|_|^]SUB))`, regexp2.None)
)

// languageWordsSeries are the full language names ParseLanguages looks for
// with a plain substring test, in Sonarr's order.
var languageWordsSeries = []struct {
	words []string
	lang  Language
}{
	{[]string{"spanish"}, LangSpanish},
	{[]string{"danish"}, LangDanish},
	{[]string{"dutch"}, LangDutch},
	{[]string{"japanese"}, LangJapanese},
	{[]string{"icelandic"}, LangIcelandic},
	{[]string{"mandarin", "cantonese", "chinese"}, LangChinese},
	{[]string{"korean"}, LangKorean},
	{[]string{"russian"}, LangRussian},
	{[]string{"polish"}, LangPolish},
	{[]string{"vietnamese"}, LangVietnamese},
	{[]string{"swedish"}, LangSwedish},
	{[]string{"norwegian"}, LangNorwegian},
	{[]string{"finnish"}, LangFinnish},
	{[]string{"turkish"}, LangTurkish},
	{[]string{"portuguese"}, LangPortuguese},
	{[]string{"hungarian"}, LangHungarian},
	{[]string{"hebrew"}, LangHebrew},
	{[]string{"arabic"}, LangArabic},
	{[]string{"hindi"}, LangHindi},
	{[]string{"malayalam"}, LangMalayalam},
	{[]string{"ukrainian"}, LangUkrainian},
	{[]string{"bulgarian"}, LangBulgarian},
	{[]string{"slovak"}, LangSlovak},
	{[]string{"brazilian", "dublado"}, LangPortugueseBR},
	{[]string{"latino"}, LangSpanishLatino},
	{[]string{"latvian"}, LangLatvian},
}

var caseSensitiveGroupsSeries = []struct {
	group string
	lang  Language
}{
	{"lithuanian", LangLithuanian},
	{"czech", LangCzech},
	{"polish", LangPolish},
	{"bulgarian", LangBulgarian},
	{"slovak", LangSlovak},
}

// languageGroupsSeries lists the LanguageRegex groups in the order Sonarr adds
// their languages. There is no "dutch" group in the regex; Sonarr checks one
// anyway, so it never matches.
var languageGroupsSeries = []struct {
	group string
	lang  Language
}{
	{"english", LangEnglish},
	{"italian", LangItalian},
	{"german", LangGerman},
	{"flemish", LangFlemish},
	{"greek", LangGreek},
	{"french", LangFrench},
	{"russian", LangRussian},
	{"dutch", LangDutch},
	{"hungarian", LangHungarian},
	{"hebrew", LangHebrew},
	{"polish", LangPolish},
	{"chinese", LangChinese},
	{"bulgarian", LangBulgarian},
	{"ukrainian", LangUkrainian},
	{"spanish", LangSpanish},
	{"thai", LangThai},
	{"romanian", LangRomanian},
	{"catalan", LangCatalan},
	{"latvian", LangLatvian},
	{"turkish", LangTurkish},
	{"original", LangOriginal},
}

// parseLanguagesSeries ports Sonarr's LanguageParser.ParseLanguages.
func parseLanguagesSeries(title string) []Language {
	title = cleanSeriesTitleLangRegex.replace(title, "$1")

	lowerTitle := strings.ToLower(title)
	var languages []Language

	for _, w := range languageWordsSeries {
		for _, word := range w.words {
			if strings.Contains(lowerTitle, word) {
				languages = append(languages, w.lang)
				break
			}
		}
	}

	languages = append(languages, regexLanguagesSeries(title)...)

	if strings.Contains(lowerTitle, "english") {
		languages = append(languages, LangEnglish)
	}

	if len(languages) == 0 {
		languages = append(languages, LangUnknown)
	}

	if len(languages) == 1 && languages[0] == LangGerman {
		if germanDualLanguageRegex.isMatch(title) {
			languages = append(languages, LangOriginal)
		} else if germanMultiLanguageRegex.isMatch(title) {
			languages = append(languages, LangOriginal, LangEnglish)
		}
	}

	return distinctLanguages(languages)
}

func regexLanguagesSeries(title string) []Language {
	var languages []Language

	// Case sensitive: Sonarr reads the first match only.
	if m := caseSensitiveLanguageRegexSeries.match(title); m != nil {
		for _, g := range caseSensitiveGroupsSeries {
			if hasGroup(m, g.group) {
				languages = append(languages, g.lang)
			}
		}
	}

	// Case insensitive
	for _, m := range languageRegexSeries.matchAll(title) {
		for _, g := range languageGroupsSeries {
			if hasGroup(m, g.group) {
				languages = append(languages, g.lang)
			}
		}
	}

	return languages
}
