package scoring_test

import (
	"reflect"
	"testing"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
)

// A language named in the Title's own name is not a language of the Release
// (Radarr's and Sonarr's AggregateLanguages): "The German Doctor" is not a
// German dub.
func TestALanguageInTheTitlesOwnNameIsNotTheReleasesLanguage(t *testing.T) {
	german := scoring.Title{Name: "The German Doctor", OriginalLanguage: release.LangSpanish}
	cases := []struct {
		name  string
		rel   string
		title scoring.Title
		want  []release.Language
	}{
		{"title word discounted, falls back to the Original Language",
			"The.German.Doctor.2013.1080p.BluRay.x264-GRP", german, []release.Language{release.LangSpanish}},
		{"a dub that also says German keeps it",
			"The.German.Doctor.2013.German.1080p.BluRay.x264-GRP", german, []release.Language{release.LangGerman}},
		{"a different Title keeps the word",
			"The.German.Doctor.2013.1080p.BluRay.x264-GRP", scoring.Title{Name: "Wakolda", OriginalLanguage: release.LangSpanish},
			[]release.Language{release.LangGerman}},
		{"Title name is compared normalised",
			"The.German.Doctor.2013.1080p.BluRay.x264-GRP",
			scoring.Title{Name: "The German Doctor!", OriginalLanguage: release.LangSpanish}, []release.Language{release.LangSpanish}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// The Movie parser swaps the title it found for "A Movie" in the
			// simple title and before it reads languages, so for a release
			// the parser read correctly there is nothing left to discount.
			// The discount matters when the library's title is not the name
			// the parser found (an alternative title, a folder name): give
			// the release the simple title and languages of the unswapped name.
			v := verdict(t, englishHD, tc.rel, tc.title, func(r *scoring.Release) {
				r.Parsed.SimpleReleaseTitle = r.Parsed.ReleaseTitle
				r.Parsed.Languages = release.ParseLanguages(r.Parsed.ReleaseTitle)
			})
			if !reflect.DeepEqual(v.Languages, tc.want) {
				t.Errorf("languages = %v, want %v", v.Languages, tc.want)
			}
		})
	}
}

func TestIndexerLanguagesAreNotDiscounted(t *testing.T) {
	title := scoring.Title{Name: "The German Doctor", OriginalLanguage: release.LangSpanish}
	v := verdict(t, englishHD, "The.German.Doctor.2013.1080p.BluRay.x264-GRP", title, func(r *scoring.Release) {
		r.IndexerLanguages = []release.Language{release.LangGerman}
	})
	if want := []release.Language{release.LangGerman}; !reflect.DeepEqual(v.Languages, want) {
		t.Errorf("languages = %v, want %v", v.Languages, want)
	}
}

func TestALanguageInAnEpisodeTitleIsNotTheReleasesLanguage(t *testing.T) {
	prof, err := gateSnapshot(t).Profile(englishHD)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := release.Parse("Show.S01E01.The.German.One.1080p.WEB-DL.DD5.1.H.264-GRP", release.KindSeries)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(parsed.Languages, []release.Language{release.LangGerman}) {
		t.Fatalf("parser gave %v", parsed.Languages)
	}
	title := scoring.Title{Name: "Show", OriginalLanguage: release.LangEnglish, EpisodeTitles: []string{"The German One"}}
	v := scoring.Evaluate(scoring.Release{Parsed: parsed}, title, prof)
	if want := []release.Language{release.LangEnglish}; !reflect.DeepEqual(v.Languages, want) {
		t.Errorf("languages = %v, want %v", v.Languages, want)
	}
	// Without the episode title it is a German release.
	title.EpisodeTitles = nil
	v = scoring.Evaluate(scoring.Release{Parsed: parsed}, title, prof)
	if want := []release.Language{release.LangGerman}; !reflect.DeepEqual(v.Languages, want) {
		t.Errorf("languages without episode titles = %v, want %v", v.Languages, want)
	}
}
