package api_test

import (
	"strings"
	"testing"
)

type profileJSON struct {
	Key                string `json:"key"`
	Name               string `json:"name"`
	Slot               string `json:"slot"`
	LanguageRule       string `json:"language_rule"`
	OriginalLanguage   string `json:"original_language"`
	OriginalFallback   bool   `json:"original_fallback"`
	Enabled            bool   `json:"enabled"`
	DefaultMovies      bool   `json:"default_movies"`
	DefaultSeries      bool   `json:"default_series"`
	MinHeight          int    `json:"min_height"`
	MaxHeight          int    `json:"max_height"`
	TrashProfileMovies string `json:"trash_profile_movies"`
	TrashProfileSeries string `json:"trash_profile_series"`
}

type settingsJSON struct {
	LanguageRegion struct {
		PrimaryLanguage    string `json:"primary_language"`
		ReleaseDateCountry string `json:"release_date_country"`
		PendingLanguage    string `json:"pending_primary_language"`
	} `json:"language_region"`
}

func profileMap(t *testing.T, b *browser) map[string]profileJSON {
	t.Helper()
	list := decode[struct {
		Items []profileJSON `json:"items"`
	}](t, b.valid("GET", "/profiles", ""))
	if len(list.Items) != 6 {
		t.Fatalf("%d Profiles, want 6", len(list.Items))
	}
	m := map[string]profileJSON{}
	for _, p := range list.Items {
		m[p.Key] = p
	}
	return m
}

func TestProfilesAreSeededAndPatchable(t *testing.T) {
	t.Parallel()
	b := newInstance(t, "").setUp()
	m := profileMap(t, b)
	hd := m["hd-primary"]
	if hd.Slot != "standard" || hd.LanguageRule != "primary" || !hd.Enabled || !hd.DefaultMovies || !hd.DefaultSeries || hd.MinHeight != 720 || hd.MaxHeight != 1080 {
		t.Errorf("hd-primary = %+v", hd)
	}

	if hd.OriginalLanguage != "reject" || hd.OriginalFallback {
		t.Errorf("hd-primary originals = %q/%v, want reject", hd.OriginalLanguage, hd.OriginalFallback)
	}
	p := decode[profileJSON](t, b.valid("PATCH", "/profiles/hd-primary", `{"original_fallback":true}`))
	if !p.OriginalFallback || p.OriginalLanguage != "accept" {
		t.Errorf("fallback not set: %+v", p)
	}
	p = decode[profileJSON](t, b.valid("PATCH", "/profiles/hd-primary", `{"original_language":"offer"}`))
	if p.OriginalFallback || p.OriginalLanguage != "offer" {
		t.Errorf("offer: %+v, want offer without the deprecated fallback", p)
	}
	if m = profileMap(t, b); m["hd-primary"].OriginalLanguage != "offer" {
		t.Error("offer not stored")
	}
	p = decode[profileJSON](t, b.valid("PATCH", "/profiles/4k-primary", `{"default_movies":true}`))
	if !p.DefaultMovies || p.DefaultSeries {
		t.Errorf("4K default: %+v", p)
	}
	if m = profileMap(t, b); !m["4k-primary"].DefaultMovies {
		t.Error("4K default not stored")
	}
}

func TestProfileRulesAreValidationErrors(t *testing.T) {
	t.Parallel()
	b := newInstance(t, "").setUp()
	for _, c := range []struct{ path, body, field string }{
		{"/profiles/hd-original", `{"original_fallback":true}`, "original_fallback"},
		{"/profiles/hd-original", `{"original_language":"offer"}`, "original_language"},
		{"/profiles/hd-primary", `{"original_language":"offer","original_fallback":true}`, "original_fallback"},
		{"/profiles/hd-primary", `{"default_movies":false}`, "default_movies"},
		{"/profiles/hd-primary", `{"enabled":false}`, "enabled"},
	} {
		r := b.do("PATCH", c.path, c.body)
		if r.Status != 422 || !strings.Contains(r.Body, `"code":"validation"`) || !strings.Contains(r.Body, `"field":"`+c.field+`"`) {
			t.Errorf("PATCH %s %s = %d %s", c.path, c.body, r.Status, r.Body)
		}
	}
	if r := b.do("PATCH", "/profiles/nope", `{"enabled":true}`); r.Status != 400 && r.Status != 404 {
		t.Errorf("unknown key = %d %s", r.Status, r.Body)
	}
}

func TestChangingThePrimaryLanguageRepointsProfiles(t *testing.T) {
	t.Parallel()
	b := newInstance(t, "").setUp()

	s := decode[settingsJSON](t, b.valid("GET", "/settings", ""))
	if s.LanguageRegion.PrimaryLanguage != "en" || s.LanguageRegion.ReleaseDateCountry != "US" {
		t.Errorf("defaults: %+v", s)
	}
	setup := b.valid("GET", "/setup", "").Body
	if !strings.Contains(setup, `"language":"todo"`) || strings.Contains(setup, "kids_rule") {
		t.Errorf("setup before saving: %s", setup)
	}

	s = decode[settingsJSON](t, b.valid("PATCH", "/settings", `{"language_region":{"primary_language":"de"}}`))
	if s.LanguageRegion.PrimaryLanguage != "en" || s.LanguageRegion.PendingLanguage != "de" {
		t.Errorf("queued: %+v, want English with German pending", s.LanguageRegion)
	}
	b.trashPass(t)
	s = decode[settingsJSON](t, b.valid("GET", "/settings", ""))
	if s.LanguageRegion.PrimaryLanguage != "de" || s.LanguageRegion.ReleaseDateCountry != "DE" || s.LanguageRegion.PendingLanguage != "" {
		t.Errorf("German: %+v", s.LanguageRegion)
	}
	m := profileMap(t, b)
	if m["hd-primary"].TrashProfileMovies != "german-hd-bluray-web" || m["4k-primary"].TrashProfileSeries != "german-uhd-bluray-web" ||
		m["hd-original"].TrashProfileMovies != "hd-bluray-web" || m["4k-original"].TrashProfileSeries != "web-2160p" {
		t.Errorf("not re-pointed: %+v", m)
	}

	// The country stays editable, and a patch that names it keeps it.
	b.valid("PATCH", "/settings", `{"language_region":{"primary_language":"fr","release_date_country":"BE"}}`)
	b.trashPass(t)
	s = decode[settingsJSON](t, b.valid("GET", "/settings", ""))
	if s.LanguageRegion.ReleaseDateCountry != "BE" {
		t.Errorf("country: %+v", s.LanguageRegion)
	}
	if m = profileMap(t, b); m["any-original"].TrashProfileSeries != "french-multi-vo-bluray-web-1080p" {
		t.Errorf("French: %+v", m["any-original"])
	}

	if setup = b.valid("GET", "/setup", "").Body; !strings.Contains(setup, `"language":"done"`) {
		t.Errorf("setup after saving: %s", setup)
	}
}

func TestProviderKeyOverridesAreSavedWithTheSettingsAndNeverShownAgain(t *testing.T) {
	t.Parallel()
	b := newInstance(t, "").setUp()
	type metaJSON struct {
		Metadata struct {
			TMDB bool `json:"tmdb_api_key_set"`
			TVDB bool `json:"tvdb_api_key_set"`
		} `json:"metadata"`
	}
	if got := decode[metaJSON](t, b.valid("GET", "/settings", "")); got.Metadata.TMDB || got.Metadata.TVDB {
		t.Fatalf("fresh settings = %+v", got)
	}

	r := b.valid("PATCH", "/settings", `{"metadata":{"tmdb_api_key":"secret-tmdb"}}`)

	if got := decode[metaJSON](t, r); !got.Metadata.TMDB || got.Metadata.TVDB {
		t.Errorf("after setting TMDB = %+v", got)
	}
	if strings.Contains(string(r.Body), "secret-tmdb") || strings.Contains(string(b.valid("GET", "/settings", "").Body), "secret-tmdb") {
		t.Error("the key was sent back")
	}
	got := decode[metaJSON](t, b.valid("PATCH", "/settings", `{"metadata":{"tmdb_api_key":"","tvdb_api_key":"secret-tvdb"}}`))
	if got.Metadata.TMDB || !got.Metadata.TVDB {
		t.Errorf("after clearing TMDB and setting TheTVDB = %+v", got)
	}
}

func TestSettingsValidation(t *testing.T) {
	t.Parallel()
	b := newInstance(t, "").setUp()
	for _, body := range []string{
		`{"language_region":{"primary_language":"xx"}}`,
		`{"language_region":{"release_date_country":"Germany"}}`,
	} {
		if r := b.do("PATCH", "/settings", body); r.Status != 422 && r.Status != 400 {
			t.Errorf("PATCH %s = %d %s", body, r.Status, r.Body)
		}
	}
}

func TestSettingsHaveNoKidsRuleOrKidsRootFolders(t *testing.T) {
	t.Parallel()
	b := newInstance(t, "").setUp()
	body := b.valid("GET", "/settings", "").Body
	if strings.Contains(strings.ToLower(body), "kids") {
		t.Errorf("GET /settings mentions kids: %s", body)
	}
	if setup := b.valid("GET", "/setup", "").Body; strings.Contains(strings.ToLower(setup), "kids") || !strings.Contains(setup, `"profiles":"done"`) {
		t.Errorf("GET /setup = %s", setup)
	}
}

func TestTheAnyProfilesTakeTheKidsProfilesPlace(t *testing.T) {
	t.Parallel()
	b := newInstance(t, "").setUp()
	r := b.valid("GET", "/profiles", "")
	if strings.Contains(strings.ToLower(r.Body), "kids") {
		t.Errorf("GET /profiles mentions kids: %s", r.Body)
	}
	m := profileMap(t, b)
	for key, name := range map[string]string{"any-primary": "Any", "any-original": "Any Original"} {
		p := m[key]
		if p.Name != name || p.Slot != "standard" || p.MinHeight != 0 || p.MaxHeight != 1080 || !p.Enabled || p.DefaultMovies || p.DefaultSeries {
			t.Errorf("%s = %+v", key, p)
		}
	}
	if m["any-original"].LanguageRule != "original" || m["any-primary"].LanguageRule != "primary" {
		t.Errorf("language rules: %+v %+v", m["any-primary"], m["any-original"])
	}
}
