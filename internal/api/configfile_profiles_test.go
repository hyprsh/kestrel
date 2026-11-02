package api_test

import (
	"context"
	"strings"
	"testing"
)

// declaredProfiles switches HD off and offers originals on 4K (the others still say it the deprecated way). The
// defaults for new Titles are the Slots', so the file declares them there: Standard takes Any for Movies and HD
// Original for Series, 4K takes 4K for both.
const declaredProfiles = `profiles:
  hd-primary:   {enabled: false, original_fallback: false}
  hd-original:  {enabled: true,  original_fallback: false}
  any-primary:  {enabled: true,  original_fallback: true}
  any-original: {enabled: false, original_fallback: false}
  4k-primary:   {enabled: true,  original_language: offer}
  4k-original:  {enabled: true,  original_fallback: false}
slots:
  - {id: standard, label: Standard, default_movies: any-primary, default_series: hd-original, on_for_new_titles: true}
  - {id: 4k, label: 4K, default_movies: 4k-primary, default_series: 4k-primary}
`

func TestDeclaredProfilesAreAppliedAsAWhole(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	in.mustDeclare(declaredProfiles)
	got := profileMap(t, in.setUp())

	want := map[string][4]bool{ // enabled, original_fallback, default_movies, default_series (derived from the Slots)
		"hd-primary":   {false, false, false, false},
		"hd-original":  {true, false, false, true}, // the Standard Slot's Series default
		"any-primary":  {true, true, true, false},
		"any-original": {false, false, false, false},
		"4k-primary":   {true, false, true, true},
		"4k-original":  {true, false, false, false},
	}
	for key, w := range want {
		p := got[key]
		if g := [4]bool{p.Enabled, p.OriginalFallback, p.DefaultMovies, p.DefaultSeries}; g != w {
			t.Errorf("%s = %v, want %v", key, g, w)
		}
	}
	if got["4k-primary"].OriginalLanguage != "offer" || got["any-primary"].OriginalLanguage != "accept" {
		t.Errorf("original_language: 4k-primary %q, any-primary %q", got["4k-primary"].OriginalLanguage, got["any-primary"].OriginalLanguage)
	}
}

func TestDeclaredProfilesAreWrittenOnlyWhenTheyDiffer(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	in.mustDeclare(declaredProfiles)

	before := in.writes()
	if err := in.app.EnforceConfigFile(context.Background()); err != nil {
		t.Fatal(err)
	}
	if after := in.writes(); after != before {
		t.Errorf("the second start changed %d rows", after-before)
	}
}

func TestInvalidDeclaredProfilesFailStartupAndWriteNothing(t *testing.T) {
	t.Parallel()
	for _, c := range []struct{ name, body, want string }{
		{"missing key", strings.Replace(declaredProfiles, "  4k-original:", "  # 4k-original:", 1), "profiles.4k-original"},
		{"unknown key", strings.Replace(declaredProfiles, "slots:", "  8k-primary:   {enabled: true, original_fallback: false}\nslots:", 1), "profiles.8k-primary"},
		{"fallback on an original", strings.Replace(declaredProfiles, "hd-original:  {enabled: true,  original_fallback: false", "hd-original:  {enabled: true,  original_fallback: true", 1), "profiles.hd-original.original_fallback"},
		{"a Slot's default switched off", strings.Replace(declaredProfiles, "4k-primary:   {enabled: true", "4k-primary:   {enabled: false", 1), "profiles.4k-primary.enabled"},
	} {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			in := newInstance(t, "")
			err := in.declare(declaredAccount+c.body, "KESTREL_ADMIN_PASSWORD", "correct horse")
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("err = %v, want one naming %s", err, c.want)
			}
			if s := in.browser().valid("GET", "/setup", ""); !strings.Contains(s.Body, `"account_exists":false`) {
				t.Errorf("setup = %s, want nothing written", s.Body)
			}
			// Kestrel would have exited; start it without the file to read the Profiles.
			in.opts.ConfigFile = nil
			in.restart()
			if p := profileMap(t, in.setUp())["hd-primary"]; !p.Enabled || !p.DefaultMovies {
				t.Errorf("hd-primary = %+v, want the shipped Profile", p)
			}
		})
	}
}
