package release

import "testing"

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
