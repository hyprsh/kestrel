package api_test

import (
	"bytes"
	"log/slog"

	"context"
	"github.com/hyprsh/kestrel/internal/app"
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

// A fresh install has no Profiles and one Slot; a file that declares profiles and slots gets exactly what it declares.
func TestAFileDeclaringProfilesAndSlotsOnAFreshInstallGetsExactlyThose(t *testing.T) {
	t.Parallel()
	in := newFreshInstance(t, "")
	in.mustDeclare(declaredProfiles)
	b := in.setUp()
	got := profileMap(t, b)
	if len(got) != 6 || !got["hd-original"].Enabled || got["hd-primary"].Enabled || !got["4k-primary"].DefaultMovies {
		t.Errorf("profiles = %+v", got)
	}
	slots := b.valid("GET", "/slots", "").Body
	if !strings.Contains(slots, `"id":"4k"`) || !strings.Contains(slots, `"default_series":"hd-original"`) {
		t.Errorf("slots = %s", slots)
	}
}

func TestDeclaredProfilesAcceptAReleaseFamilyAndANamedLanguage(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	body := strings.Replace(declaredProfiles, "hd-primary:   {enabled: false, original_fallback: false}",
		"hd-primary:   {enabled: false, original_fallback: false, release_family: remux-web}", 1)
	body = strings.Replace(body, "4k-original:  {enabled: true,  original_fallback: false}",
		"4k-original:  {enabled: true,  original_language: offer, release_family: web, language_rule: de}", 1)
	in.mustDeclare(strings.Replace(body, "release_family: web, language_rule: de", "release_family: remux-web, language_rule: de", 1))
	m := profileMap(t, in.setUp())
	if p := m["hd-primary"]; p.ReleaseFamily != "remux-web" || p.LanguageRule != "primary" || p.TrashProfileMovies != "remux-web-1080p" {
		t.Errorf("hd-primary = %+v", p)
	}
	if p := m["4k-original"]; p.ReleaseFamily != "remux-web" || p.LanguageRule != "de" || p.OriginalLanguage != "offer" || p.TrashProfileSeries != "german-uhd-remux-web" {
		t.Errorf("4k-original = %+v", p)
	}
	if p := m["any-primary"]; p.ReleaseFamily != "bluray-web" {
		t.Errorf("any-primary = %+v, want the family it was", p)
	}
}

func TestAnEnabledDeclaredProfileWithoutABackingProfileFailsStartup(t *testing.T) {
	t.Parallel()
	for _, c := range []struct{ name, from, to, want string }{
		{"German WEB", "4k-original:  {enabled: true,  original_fallback: false}", "4k-original:  {enabled: true, original_fallback: false, release_family: web, language_rule: de}", "profiles.4k-original.release_family"},
		{"German SQP", "4k-original:  {enabled: true,  original_fallback: false}", "4k-original:  {enabled: true, original_fallback: false, release_family: sqp, language_rule: de}", "profiles.4k-original.release_family"},
		{"Any with Remux", "any-primary:  {enabled: true,  original_fallback: true}", "any-primary:  {enabled: true, original_fallback: true, release_family: remux-web}", "profiles.any-primary.release_family"},
		{"an unknown language", "4k-original:  {enabled: true,  original_fallback: false}", "4k-original:  {enabled: true, original_fallback: false, language_rule: es}", "profiles.4k-original.language_rule"},
	} {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			in := newInstance(t, "")
			err := in.declare(declaredAccount+strings.Replace(declaredProfiles, c.from, c.to, 1), "KESTREL_ADMIN_PASSWORD", "correct horse")
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("err = %v, want one naming %s", err, c.want)
			}
		})
	}
}

// SQP is a Movies-only Profile: it may be a Slot's Movies default but not its Series default.
func TestAMoviesOnlyProfileCanBeASlotsMoviesDefaultButNotItsSeriesDefault(t *testing.T) {
	t.Parallel()
	sqp := strings.Replace(declaredProfiles, "hd-original:  {enabled: true,  original_fallback: false}",
		"hd-original:  {enabled: true,  original_fallback: false, release_family: sqp}", 1)

	bad := newInstance(t, "")
	err := bad.declare(declaredAccount+sqp, "KESTREL_ADMIN_PASSWORD", "correct horse") // hd-original is the Series default
	if err == nil || !strings.Contains(err.Error(), "hd-original") || !strings.Contains(err.Error(), "Series") {
		t.Fatalf("err = %v, want one saying hd-original does not apply to Series", err)
	}

	ok := newInstance(t, "")
	ok.mustDeclare(strings.Replace(sqp, "default_movies: any-primary, default_series: hd-original", "default_movies: hd-original, default_series: any-primary", 1))
	p := profileMap(t, ok.setUp())["hd-original"]
	if p.ReleaseFamily != "sqp" || p.TrashProfileMovies != "sqp-1-1080p" || p.TrashProfileSeries != "" || len(p.Kinds) != 1 || p.Kinds[0] != "movie" {
		t.Errorf("hd-original = %+v, want SQP for Movies only", p)
	}
}

// A file that changes the Primary Language and the Profiles at once is checked and applied against the language it
// brings: the Profiles first, so the saved ones never have to survive the new language.
func TestAFileThatChangesTheLanguageAndTheProfilesAtOnceStarts(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	remux := strings.Replace(declaredProfiles, "4k-primary:   {enabled: true,  original_language: offer}",
		"4k-primary:   {enabled: true,  original_language: offer, release_family: remux-web}", 1)
	in.mustDeclare(remux)

	// French has no Remux for Series, so 4K (Slot 4K's default for both kinds) must stop following the Primary Language.
	next := strings.Replace(remux, "release_family: remux-web}", "release_family: remux-web, language_rule: de}", 1)
	in.mustDeclare("language_region:\n  primary_language: fr\n  release_date_country: FR\n" + next)
	var rule, series, lang string
	if err := in.st.Read().QueryRow(`SELECT language_rule, trash_profile_series FROM profiles WHERE key = '4k-primary'`).Scan(&rule, &series); err != nil {
		t.Fatal(err)
	}
	if rule != "de" || series != "german-uhd-remux-web" {
		t.Errorf("4k-primary = %q backed by %q", rule, series)
	}
	if err := in.st.Read().QueryRow(`SELECT value FROM settings WHERE key = 'language_region'`).Scan(&lang); err != nil || !strings.Contains(lang, `"fr"`) {
		t.Errorf("language = %s, %v, want French", lang, err)
	}
}

func TestAProfileKeyForADefaultIsIgnoredAndWarnedAboutAtStartup(t *testing.T) {
	t.Parallel()
	var log bytes.Buffer
	in := newInstance(t, "", func(o *app.Options) { o.Logger = slog.New(slog.NewTextHandler(&log, nil)) })
	body := strings.Replace(declaredProfiles, "hd-original:  {enabled: true,  original_fallback: false}", "hd-original:  {enabled: true,  original_fallback: false, default_movies: true, default_series: false}", 1)
	body = strings.Replace(body, "4k-primary:   {enabled: true,  original_language: offer}", "4k-primary:   {enabled: true,  original_language: offer, default_series: true}", 1)

	in.mustDeclare(body)

	out := log.String()
	for _, want := range []string{"hd-original", "default_movies", "4k-primary", "default_series", "slots"} {
		if !strings.Contains(out, want) {
			t.Errorf("the log lacks %q: %s", want, out)
		}
	}
	if strings.Contains(out, "any-primary") {
		t.Errorf("the log names a Profile that sets no default: %s", out)
	}
	if p := profileMap(t, in.setUp())["hd-original"]; p.DefaultMovies {
		t.Errorf("hd-original = %+v, the key must be ignored", p)
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
		{"a Slot's default left out", strings.Replace(declaredProfiles, "  4k-primary:   {enabled: true,  original_language: offer}\n", "", 1), "4k-primary"},
		{"a recipe Profile without a recipe", strings.Replace(declaredProfiles, "slots:", "  8k-primary:   {enabled: true, original_fallback: false}\nslots:", 1), "profiles.8k-primary"},
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
