package release

import "strings"

// isoLanguages maps ISO 639-1 codes, as metadata providers give a Title's
// original language, to the *arr table.
var isoLanguages = map[string]Language{
	"en": LangEnglish, "fr": LangFrench, "es": LangSpanish, "de": LangGerman, "it": LangItalian, "da": LangDanish,
	"nl": LangDutch, "ja": LangJapanese, "is": LangIcelandic, "zh": LangChinese, "ru": LangRussian, "pl": LangPolish,
	"vi": LangVietnamese, "sv": LangSwedish, "no": LangNorwegian, "nb": LangNorwegian, "fi": LangFinnish,
	"tr": LangTurkish, "pt": LangPortuguese, "el": LangGreek, "ko": LangKorean, "hu": LangHungarian, "he": LangHebrew,
	"lt": LangLithuanian, "cs": LangCzech, "hi": LangHindi, "ro": LangRomanian, "th": LangThai, "bg": LangBulgarian,
	"ar": LangArabic, "uk": LangUkrainian, "fa": LangPersian, "bn": LangBengali, "sk": LangSlovak, "lv": LangLatvian,
	"ca": LangCatalan, "hr": LangCroatian, "sr": LangSerbian, "bs": LangBosnian, "et": LangEstonian, "ta": LangTamil,
	"id": LangIndonesian, "te": LangTelugu, "mk": LangMacedonian, "sl": LangSlovenian, "ml": LangMalayalam,
	"kn": LangKannada, "sq": LangAlbanian, "af": LangAfrikaans, "mr": LangMarathi, "tl": LangTagalog, "ur": LangUrdu,
	"rm": LangRomansh, "mn": LangMongolian, "ka": LangGeorgian,
}

// LanguageByName returns the *arr language an indexer names ("German", any
// case), or LangUnknown when it is not in the table.
func LanguageByName(name string) Language {
	name = strings.TrimSpace(name)
	for _, l := range isoLanguages {
		if strings.EqualFold(l.Name, name) {
			return l
		}
	}
	return LangUnknown
}

// LanguageByISO returns the *arr language for an ISO 639-1 code (any case), or
// LangUnknown when the code is empty or not in the table.
func LanguageByISO(code string) Language {
	if l, ok := isoLanguages[strings.ToLower(code)]; ok {
		return l
	}
	return LangUnknown
}
