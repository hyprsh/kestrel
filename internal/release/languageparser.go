package release

// Ported from Radarr v5.28.0.10274 (54cbbe05d976ac053744012f8b48d44e384e2d41):
// src/NzbDrone.Core/Parser/LanguageParser.cs (ParseLanguages; the subtitle
// file parsers are not part of release name parsing). Radarr is GPL-3.0, like
// Kestrel.

import (
	"strings"

	"github.com/dlclark/regexp2"
)

var (
	languageRegex = cix(`(?:\W|_|^)(?<english>\beng\b)|
                                                                            (?<italian>\b(?:ita|italian)\b)|
                                                                            (?<german>(?:swiss)?german\b|videomann|ger[. ]dub|\bger\b)|
                                                                            (?<flemish>flemish)|
                                                                            (?<bulgarian>bgaudio)|
                                                                            (?<romanian>rodubbed)|
                                                                            (?<brazilian>\b(dublado|pt-BR)\b)|
                                                                            (?<greek>greek)|
                                                                            (?<french>\b(?:FR|VO|VF|VFF|VFQ|VFI|VF2|TRUEFRENCH|FRENCH|FRE|FRA)\b)|
                                                                            (?<russian>\b(?:rus|ru)\b)|
                                                                            (?<hungarian>\b(?:HUNDUB|HUN)\b)|
                                                                            (?<hebrew>\b(?:HebDub|HebDubbed)\b)|
                                                                            (?<polish>\b(?:PL\W?DUB|DUB\W?PL|LEK\W?PL|PL\W?LEK)\b)|
                                                                            (?<chinese>\[(?:CH[ST]|BIG5|GB)\]|简|繁|字幕)|
                                                                            (?<ukrainian>(?:(?:\dx)?UKR))|
                                                                            (?<spanish>\b(?:español|castellano)\b)|
                                                                            (?<catalan>\b(?:catalan?|catalán|català)\b)|
                                                                            (?<latvian>\b(?:lat|lav|lv)\b)|
                                                                            (?<telugu>\btel\b)|
                                                                            (?<vietnamese>\bVIE\b)|
                                                                            (?<japanese>\bJAP\b)|
                                                                            (?<korean>\bKOR\b)|
                                                                            (?<urdu>\burdu\b)|
                                                                            (?<romansh>\b(?:romansh|rumantsch|romansch)\b)|
                                                                            (?<mongolian>\b(?:mongolian|khalkha)\b)|
                                                                            (?<georgian>\b(?:georgian|geo|ka|kat)\b)|
                                                                            (?<original>\b(?:orig|original)\b)`)

	caseSensitiveLanguageRegex = mustRx(`(?:(?i)(?<!SUB[\W|_|^]))(?:(?<english>\bEN\b)|
                                                                                                          (?<lithuanian>\bLT\b)|
                                                                                                          (?<czech>\bCZ\b)|
                                                                                                          (?<polish>\bPL\b)|
                                                                                                          (?<bulgarian>\bBG\b)|
                                                                                                          (?<slovak>\bSK\b)|
                                                                                                          (?<german>\bDE\b)|
                                                                                                          (?<spanish>\b(?<!DTS[._ -])ES\b))(?:(?i)(?![\W|_|^]SUB))`, regexp2.IgnorePatternWhitespace)

	germanDualLanguageRegex  = ci(`(?<!WEB[-_. ]?)\bDL\b`)
	germanMultiLanguageRegex = ci(`\bML\b`)
)

// languageWords are the full language names ParseLanguages looks for with a
// plain substring test, in Radarr's order. Several words may share a language.
var languageWords = []struct {
	words []string
	lang  Language
}{
	{[]string{"english"}, LangEnglish},
	{[]string{"spanish"}, LangSpanish},
	{[]string{"danish"}, LangDanish},
	{[]string{"dutch"}, LangDutch},
	{[]string{"japanese"}, LangJapanese},
	{[]string{"icelandic"}, LangIcelandic},
	{[]string{"mandarin", "cantonese", "chinese"}, LangChinese},
	{[]string{"korean"}, LangKorean},
	{[]string{"russian"}, LangRussian},
	{[]string{"romanian"}, LangRomanian},
	{[]string{"hindi"}, LangHindi},
	{[]string{"arabic"}, LangArabic},
	{[]string{"thai"}, LangThai},
	{[]string{"bulgarian"}, LangBulgarian},
	{[]string{"polish"}, LangPolish},
	{[]string{"vietnamese"}, LangVietnamese},
	{[]string{"swedish"}, LangSwedish},
	{[]string{"norwegian"}, LangNorwegian},
	{[]string{"finnish"}, LangFinnish},
	{[]string{"turkish"}, LangTurkish},
	{[]string{"portuguese"}, LangPortuguese},
	{[]string{"brazilian"}, LangPortugueseBR},
	{[]string{"hungarian"}, LangHungarian},
	{[]string{"hebrew"}, LangHebrew},
	{[]string{"ukrainian"}, LangUkrainian},
	{[]string{"persian"}, LangPersian},
	{[]string{"bengali"}, LangBengali},
	{[]string{"slovak"}, LangSlovak},
	{[]string{"latvian"}, LangLatvian},
	{[]string{"latino"}, LangSpanishLatino},
	{[]string{"tamil"}, LangTamil},
	{[]string{"telugu"}, LangTelugu},
	{[]string{"malayalam"}, LangMalayalam},
	{[]string{"kannada"}, LangKannada},
	{[]string{"albanian"}, LangAlbanian},
	{[]string{"afrikaans"}, LangAfrikaans},
	{[]string{"marathi"}, LangMarathi},
	{[]string{"tagalog"}, LangTagalog},
}

// caseSensitiveGroups lists the CaseSensitiveLanguageRegex groups in the order
// Radarr adds their languages.
var caseSensitiveGroups = []struct {
	group string
	lang  Language
}{
	{"english", LangEnglish},
	{"lithuanian", LangLithuanian},
	{"czech", LangCzech},
	{"polish", LangPolish},
	{"bulgarian", LangBulgarian},
	{"slovak", LangSlovak},
	{"spanish", LangSpanish},
	{"german", LangGerman},
}

// languageGroups lists the LanguageRegex groups in the order Radarr adds
// their languages. There is no "dutch" group in the regex; Radarr checks one
// anyway, so it never matches.
var languageGroups = []struct {
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
	{"bulgarian", LangBulgarian},
	{"brazilian", LangPortugueseBR},
	{"dutch", LangDutch},
	{"hungarian", LangHungarian},
	{"hebrew", LangHebrew},
	{"polish", LangPolish},
	{"chinese", LangChinese},
	{"spanish", LangSpanish},
	{"catalan", LangCatalan},
	{"ukrainian", LangUkrainian},
	{"latvian", LangLatvian},
	{"romanian", LangRomanian},
	{"telugu", LangTelugu},
	{"vietnamese", LangVietnamese},
	{"japanese", LangJapanese},
	{"korean", LangKorean},
	{"urdu", LangUrdu},
	{"romansh", LangRomansh},
	{"mongolian", LangMongolian},
	{"georgian", LangGeorgian},
	{"original", LangOriginal},
}

// ParseLanguages reads the languages named in a release title. Original is
// kept in the result for the scoring stage to resolve; Unknown means nothing
// was recognised.
func ParseLanguages(title string) []Language {
	lowerTitle := strings.ToLower(title)
	var languages []Language

	for _, w := range languageWords {
		for _, word := range w.words {
			if strings.Contains(lowerTitle, word) {
				languages = append(languages, w.lang)
				break
			}
		}
	}

	// Case-sensitive
	for _, m := range caseSensitiveLanguageRegex.matchAll(title) {
		for _, g := range caseSensitiveGroups {
			if hasGroup(m, g.group) {
				languages = append(languages, g.lang)
			}
		}
	}

	// Case-insensitive
	for _, m := range languageRegex.matchAll(title) {
		for _, g := range languageGroups {
			if hasGroup(m, g.group) {
				languages = append(languages, g.lang)
			}
		}
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
