package scoring_test

import (
	"errors"
	"testing"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
)

// The backing-profile table of ADR 0026: Release Family x language rule x Primary Language x kind.
// The names are TRaSH's files; "" means no profile backs the recipe for that kind.
func TestBackingProfileForEveryRecipe(t *testing.T) {
	en, de, fr := release.LangEnglish, release.LangGerman, release.LangFrench
	none := release.Language{}
	primary, original, named := scoring.PrimaryLanguage, scoring.OriginalLanguage, scoring.NamedLanguage
	bw, rw, web, sqp := scoring.FamilyBlurayWeb, scoring.FamilyRemuxWeb, scoring.FamilyWeb, scoring.FamilySQP
	rows := []struct {
		family  scoring.ReleaseFamily
		rule    scoring.LanguageRule
		named   release.Language
		primary release.Language
		uhd     bool
		movie   string
		series  string
	}{
		// Bluray + WEB: today's table.
		{bw, primary, none, en, false, "hd-bluray-web", "web-1080p"},
		{bw, primary, none, en, true, "uhd-bluray-web", "web-2160p"},
		{bw, primary, none, de, false, "german-hd-bluray-web", "german-hd-bluray-web"},
		{bw, primary, none, fr, true, "french-multi-vf-uhd-bluray-web", "french-multi-vf-bluray-web-2160p"},
		{bw, original, none, de, false, "hd-bluray-web", "web-1080p"},
		{bw, original, none, de, true, "uhd-bluray-web", "web-2160p"},
		{bw, original, none, fr, false, "french-multi-vo-hd-bluray-web", "french-multi-vo-bluray-web-1080p"},
		{"", primary, none, en, false, "hd-bluray-web", "web-1080p"}, // no family is Bluray + WEB
		{bw, named, de, en, false, "german-hd-bluray-web", "german-hd-bluray-web"},
		{bw, named, fr, en, false, "french-multi-vf-hd-bluray-web", "french-multi-vf-bluray-web-1080p"},
		// Remux + WEB.
		{rw, primary, none, en, false, "remux-web-1080p", "remux-web-1080p"},
		{rw, primary, none, en, true, "remux-web-2160p", "remux-web-2160p"},
		{rw, primary, none, de, false, "german-hd-remux-web", "german-hd-remux-web"},
		{rw, primary, none, de, true, "german-uhd-remux-web", "german-uhd-remux-web"},
		{rw, primary, none, fr, false, "french-multi-vf-hd-remux-web", ""},
		{rw, primary, none, fr, true, "french-multi-vf-uhd-remux-web", ""},
		{rw, original, none, de, false, "remux-web-1080p", "remux-web-1080p"},
		{rw, original, none, fr, false, "remux-web-1080p", "remux-web-1080p"},
		{rw, named, de, en, false, "german-hd-remux-web", "german-hd-remux-web"},
		{rw, named, fr, de, false, "french-multi-vf-hd-remux-web", ""},
		{rw, named, en, fr, true, "remux-web-2160p", "remux-web-2160p"},
		// WEB.
		{web, primary, none, en, false, "web-1080p", "web-1080p"},
		{web, primary, none, en, true, "web-2160p", "web-2160p"},
		{web, primary, none, de, false, "", ""},
		{web, primary, none, fr, false, "", ""},
		{web, original, none, de, false, "web-1080p", "web-1080p"},
		{web, named, en, de, true, "web-2160p", "web-2160p"},
		{web, named, de, en, false, "", ""},
		// SQP: English Movies only.
		{sqp, primary, none, en, false, "sqp-1-1080p", ""},
		{sqp, primary, none, en, true, "sqp-1-2160p", ""},
		{sqp, original, none, de, false, "sqp-1-1080p", ""},
		{sqp, primary, none, de, false, "", ""},
		{sqp, named, fr, en, false, "", ""},
	}
	for _, r := range rows {
		spec := scoring.ProfileSpec{Family: r.family, Rule: r.rule, Language: r.named, Primary: r.primary, UHD: r.uhd}
		for kind, want := range map[release.Kind]string{release.KindMovie: r.movie, release.KindSeries: r.series} {
			got, ok := scoring.BackingProfile(spec, kind)
			if got != want || ok != (want != "") {
				t.Errorf("family %q rule %d named %q primary %s uhd=%v kind %v: got %q,%v want %q", r.family, r.rule, r.named.Name, r.primary.Name, r.uhd, kind, got, ok, want)
			}
		}
	}
}

func TestAnyIsBlurayWebAtHDOnly(t *testing.T) {
	snap := embedded(t)
	for _, f := range []scoring.ReleaseFamily{scoring.FamilyRemuxWeb, scoring.FamilyWeb, scoring.FamilySQP} {
		_, err := snap.Profile(scoring.ProfileSpec{Any: true, Family: f, Primary: release.LangEnglish})
		if !errors.Is(err, scoring.ErrUnsupportedProfile) {
			t.Errorf("Any with %s: err = %v, want ErrUnsupportedProfile", f, err)
		}
	}
	if _, err := snap.Profile(scoring.ProfileSpec{Any: true, Family: scoring.FamilyBlurayWeb, Primary: release.LangEnglish}); err != nil {
		t.Errorf("Any with Bluray + WEB: %v", err)
	}
	if _, err := snap.Profile(scoring.ProfileSpec{Any: true, UHD: true, Primary: release.LangEnglish}); !errors.Is(err, scoring.ErrUnsupportedProfile) {
		t.Errorf("Any 4K: err = %v", err)
	}
}

func TestARecipeWithoutABackingProfileForAKindDoesNotResolve(t *testing.T) {
	snap := embedded(t)
	cases := []scoring.ProfileSpec{
		{Family: scoring.FamilyRemuxWeb, Rule: scoring.PrimaryLanguage, Primary: release.LangFrench}, // French Remux for Series
		{Family: scoring.FamilyWeb, Rule: scoring.PrimaryLanguage, Primary: release.LangGerman},      // German WEB
		{Family: scoring.FamilySQP, Rule: scoring.PrimaryLanguage, Primary: release.LangEnglish},     // SQP for Series
		{Family: scoring.FamilyBlurayWeb, Rule: scoring.NamedLanguage, Language: release.LangSpanish, Primary: release.LangEnglish},
	}
	for _, spec := range cases {
		if _, err := snap.Profile(spec); !errors.Is(err, scoring.ErrUnsupportedProfile) {
			t.Errorf("%+v: err = %v, want ErrUnsupportedProfile", spec, err)
		}
	}
}

// Every name the table gives is a profile the bundled TRaSH data really has, not one assumed from a pattern.
func TestEveryBackingProfileTheTableNamesIsBundled(t *testing.T) {
	snap := embedded(t)
	families := []scoring.ReleaseFamily{scoring.FamilyBlurayWeb, scoring.FamilyRemuxWeb, scoring.FamilyWeb, scoring.FamilySQP}
	rules := []scoring.LanguageRule{scoring.PrimaryLanguage, scoring.OriginalLanguage, scoring.NamedLanguage}
	langs := []release.Language{release.LangEnglish, release.LangGerman, release.LangFrench}
	seen := 0
	for _, family := range families {
		for _, rule := range rules {
			for _, lang := range langs {
				for _, uhd := range []bool{false, true} {
					spec := scoring.ProfileSpec{Family: family, Rule: rule, Language: lang, Primary: lang, UHD: uhd}
					for _, kind := range []release.Kind{release.KindMovie, release.KindSeries} {
						name, ok := scoring.BackingProfile(spec, kind)
						if !ok {
							continue
						}
						seen++
						if !snap.HasBackingProfile(kind, name) {
							t.Errorf("%+v %v: %q is not a bundled TRaSH profile", spec, kind, name)
						}
					}
				}
			}
		}
	}
	if seen == 0 {
		t.Fatal("the table named no profile")
	}
}
