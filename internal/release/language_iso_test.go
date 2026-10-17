package release

import "testing"

func TestLanguageByNameReadsTheNamesIndexersGive(t *testing.T) {
	for name, want := range map[string]Language{
		"German": LangGerman, "english": LangEnglish, " French ": LangFrench, "Klingon": LangUnknown, "": LangUnknown,
	} {
		if got := LanguageByName(name); got != want {
			t.Errorf("LanguageByName(%q) = %v, want %v", name, got, want)
		}
	}
}

func TestLanguageByISOMapsMetadataCodesToArrLanguages(t *testing.T) {
	for code, want := range map[string]Language{
		"en": LangEnglish, "de": LangGerman, "fr": LangFrench, "ja": LangJapanese, "ko": LangKorean,
		"DE": LangGerman, "xx": LangUnknown, "": LangUnknown,
	} {
		if got := LanguageByISO(code); got != want {
			t.Errorf("LanguageByISO(%q) = %v, want %v", code, got, want)
		}
	}
}
