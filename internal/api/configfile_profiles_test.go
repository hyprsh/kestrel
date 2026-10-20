package api_test

import (
	"context"
	"strings"
	"testing"
)

// declaredProfiles moves both Standard defaults off HD, which is switched off,
// and makes 4K the 4K default for movies.
const declaredProfiles = `profiles:
  hd-primary:   {enabled: false, original_fallback: false, default_movies: false, default_series: false}
  hd-original:  {enabled: true,  original_fallback: false, default_movies: false, default_series: true}
  any-primary:  {enabled: true,  original_fallback: true,  default_movies: true,  default_series: false}
  any-original: {enabled: false, original_fallback: false, default_movies: false, default_series: false}
  4k-primary:   {enabled: true,  original_fallback: false, default_movies: true,  default_series: false}
  4k-original:  {enabled: true,  original_fallback: false, default_movies: false, default_series: false}
`

func TestDeclaredProfilesAreAppliedAsAWhole(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	in.mustDeclare(declaredProfiles)
	got := profileMap(t, in.setUp())

	want := map[string][4]bool{ // enabled, original_fallback, default_movies, default_series
		"hd-primary":   {false, false, false, false},
		"hd-original":  {true, false, false, true},
		"any-primary":  {true, true, true, false},
		"any-original": {false, false, false, false},
		"4k-primary":   {true, false, true, false},
		"4k-original":  {true, false, false, false},
	}
	for key, w := range want {
		p := got[key]
		if g := [4]bool{p.Enabled, p.OriginalFallback, p.DefaultMovies, p.DefaultSeries}; g != w {
			t.Errorf("%s = %v, want %v", key, g, w)
		}
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
		{"unknown key", declaredProfiles + "  8k-primary:   {enabled: true, original_fallback: false, default_movies: false, default_series: false}\n", "profiles.8k-primary"},
		{"fallback on an original", strings.Replace(declaredProfiles, "hd-original:  {enabled: true,  original_fallback: false", "hd-original:  {enabled: true,  original_fallback: true", 1), "profiles.hd-original.original_fallback"},
		{"disabled default", strings.Replace(declaredProfiles, "4k-primary:   {enabled: true", "4k-primary:   {enabled: false", 1), "profiles.4k-primary.default_movies"},
		{"no Standard default", strings.Replace(declaredProfiles, "default_movies: true,  default_series: false}\n  any-original", "default_movies: false, default_series: false}\n  any-original", 1), "profiles: the Standard Slot"},
		{"two defaults in a Slot", strings.Replace(declaredProfiles, "4k-original:  {enabled: true,  original_fallback: false, default_movies: false", "4k-original:  {enabled: true,  original_fallback: false, default_movies: true", 1), "profiles.4k-original.default_movies"},
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
