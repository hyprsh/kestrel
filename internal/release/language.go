package release

// Language is an *arr language: the numeric id and name Radarr and Sonarr use
// in their API. Original (-2) and Any (-1) are pseudo-languages: Original is
// kept as parsed and resolved by the scoring stage against the Title's
// Original Language.
type Language struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

func (l Language) String() string { return l.Name }

// The language table is shared by Radarr and Sonarr (same ids and names).
var (
	LangUnknown       = Language{0, "Unknown"}
	LangEnglish       = Language{1, "English"}
	LangFrench        = Language{2, "French"}
	LangSpanish       = Language{3, "Spanish"}
	LangGerman        = Language{4, "German"}
	LangItalian       = Language{5, "Italian"}
	LangDanish        = Language{6, "Danish"}
	LangDutch         = Language{7, "Dutch"}
	LangJapanese      = Language{8, "Japanese"}
	LangIcelandic     = Language{9, "Icelandic"}
	LangChinese       = Language{10, "Chinese"}
	LangRussian       = Language{11, "Russian"}
	LangPolish        = Language{12, "Polish"}
	LangVietnamese    = Language{13, "Vietnamese"}
	LangSwedish       = Language{14, "Swedish"}
	LangNorwegian     = Language{15, "Norwegian"}
	LangFinnish       = Language{16, "Finnish"}
	LangTurkish       = Language{17, "Turkish"}
	LangPortuguese    = Language{18, "Portuguese"}
	LangFlemish       = Language{19, "Flemish"}
	LangGreek         = Language{20, "Greek"}
	LangKorean        = Language{21, "Korean"}
	LangHungarian     = Language{22, "Hungarian"}
	LangHebrew        = Language{23, "Hebrew"}
	LangLithuanian    = Language{24, "Lithuanian"}
	LangCzech         = Language{25, "Czech"}
	LangHindi         = Language{26, "Hindi"}
	LangRomanian      = Language{27, "Romanian"}
	LangThai          = Language{28, "Thai"}
	LangBulgarian     = Language{29, "Bulgarian"}
	LangPortugueseBR  = Language{30, "Portuguese (Brazil)"}
	LangArabic        = Language{31, "Arabic"}
	LangUkrainian     = Language{32, "Ukrainian"}
	LangPersian       = Language{33, "Persian"}
	LangBengali       = Language{34, "Bengali"}
	LangSlovak        = Language{35, "Slovak"}
	LangLatvian       = Language{36, "Latvian"}
	LangSpanishLatino = Language{37, "Spanish (Latino)"}
	LangCatalan       = Language{38, "Catalan"}
	LangCroatian      = Language{39, "Croatian"}
	LangSerbian       = Language{40, "Serbian"}
	LangBosnian       = Language{41, "Bosnian"}
	LangEstonian      = Language{42, "Estonian"}
	LangTamil         = Language{43, "Tamil"}
	LangIndonesian    = Language{44, "Indonesian"}
	LangTelugu        = Language{45, "Telugu"}
	LangMacedonian    = Language{46, "Macedonian"}
	LangSlovenian     = Language{47, "Slovenian"}
	LangMalayalam     = Language{48, "Malayalam"}
	LangKannada       = Language{49, "Kannada"}
	LangAlbanian      = Language{50, "Albanian"}
	LangAfrikaans     = Language{51, "Afrikaans"}
	LangMarathi       = Language{52, "Marathi"}
	LangTagalog       = Language{53, "Tagalog"}
	LangUrdu          = Language{54, "Urdu"}
	LangRomansh       = Language{55, "Romansh"}
	LangMongolian     = Language{56, "Mongolian"}
	LangGeorgian      = Language{57, "Georgian"}
	LangAny           = Language{-1, "Any"}
	LangOriginal      = Language{-2, "Original"}
)

// distinctLanguages drops later duplicates by id, keeping first-seen order.
func distinctLanguages(in []Language) []Language {
	seen := make(map[int]bool, len(in))
	out := make([]Language, 0, len(in))
	for _, l := range in {
		if !seen[l.ID] {
			seen[l.ID] = true
			out = append(out, l)
		}
	}
	return out
}
