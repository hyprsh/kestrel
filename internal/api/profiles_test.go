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
	} `json:"language_region"`
	KidsRule struct {
		Enabled   bool `json:"enabled"`
		Threshold int  `json:"threshold"`
	} `json:"kids_rule"`
}

func profileMap(t *testing.T, b *browser) map[string]profileJSON {
	t.Helper()
	list := decode[struct {
		Items []profileJSON `json:"items"`
	}](t, b.valid("GET", "/profiles", ""))
	if len(list.Items) != 8 {
		t.Fatalf("%d Profiles, want 8", len(list.Items))
	}
	m := map[string]profileJSON{}
	for _, p := range list.Items {
		m[p.Key] = p
	}
	return m
}

func TestProfilesAreSeededAndPatchable(t *testing.T) {
	b := newInstance(t, "").setUp()
	m := profileMap(t, b)
	hd := m["hd-primary"]
	if hd.Slot != "hd" || hd.LanguageRule != "primary" || !hd.Enabled || !hd.DefaultMovies || !hd.DefaultSeries || hd.MinHeight != 720 || hd.MaxHeight != 1080 {
		t.Errorf("hd-primary = %+v", hd)
	}

	p := decode[profileJSON](t, b.valid("PATCH", "/profiles/hd-primary", `{"original_fallback":true}`))
	if !p.OriginalFallback {
		t.Errorf("fallback not set: %+v", p)
	}
	p = decode[profileJSON](t, b.valid("PATCH", "/profiles/uhd-primary", `{"default_movies":true}`))
	if !p.DefaultMovies || p.DefaultSeries {
		t.Errorf("UHD default: %+v", p)
	}
	if m = profileMap(t, b); !m["uhd-primary"].DefaultMovies {
		t.Error("UHD default not stored")
	}
}

func TestProfileRulesAreValidationErrors(t *testing.T) {
	b := newInstance(t, "").setUp()
	for _, c := range []struct{ path, body, field string }{
		{"/profiles/hd-original", `{"original_fallback":true}`, "original_fallback"},
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
	b := newInstance(t, "").setUp()

	s := decode[settingsJSON](t, b.valid("GET", "/settings", ""))
	if s.LanguageRegion.PrimaryLanguage != "en" || s.LanguageRegion.ReleaseDateCountry != "US" || !s.KidsRule.Enabled || s.KidsRule.Threshold != 6 {
		t.Errorf("defaults: %+v", s)
	}
	setup := b.valid("GET", "/setup", "").Body
	if !strings.Contains(setup, `"language":"todo"`) || !strings.Contains(setup, `"profiles":"todo"`) {
		t.Errorf("setup before saving: %s", setup)
	}

	s = decode[settingsJSON](t, b.valid("PATCH", "/settings", `{"language_region":{"primary_language":"de"}}`))
	if s.LanguageRegion.PrimaryLanguage != "de" || s.LanguageRegion.ReleaseDateCountry != "DE" {
		t.Errorf("German: %+v", s.LanguageRegion)
	}
	m := profileMap(t, b)
	if m["hd-primary"].TrashProfileMovies != "german-hd-bluray-web" || m["uhd-primary"].TrashProfileSeries != "german-uhd-bluray-web" ||
		m["hd-original"].TrashProfileMovies != "hd-bluray-web" || m["uhd-original"].TrashProfileSeries != "web-2160p" {
		t.Errorf("not re-pointed: %+v", m)
	}

	// The country stays editable, and a patch that names it keeps it.
	s = decode[settingsJSON](t, b.valid("PATCH", "/settings", `{"language_region":{"primary_language":"fr","release_date_country":"BE"}}`))
	if s.LanguageRegion.ReleaseDateCountry != "BE" {
		t.Errorf("country: %+v", s.LanguageRegion)
	}
	if m = profileMap(t, b); m["kids-original"].TrashProfileSeries != "french-multi-vo-bluray-web-1080p" {
		t.Errorf("French: %+v", m["kids-original"])
	}

	if setup = b.valid("GET", "/setup", "").Body; !strings.Contains(setup, `"language":"done"`) {
		t.Errorf("setup after saving: %s", setup)
	}
}

func TestSettingsValidationAndKidsRule(t *testing.T) {
	b := newInstance(t, "").setUp()
	for _, body := range []string{
		`{"language_region":{"primary_language":"xx"}}`,
		`{"language_region":{"release_date_country":"Germany"}}`,
		`{"kids_rule":{"threshold":9}}`,
	} {
		if r := b.do("PATCH", "/settings", body); r.Status != 422 && r.Status != 400 {
			t.Errorf("PATCH %s = %d %s", body, r.Status, r.Body)
		}
	}
	s := decode[settingsJSON](t, b.valid("PATCH", "/settings", `{"kids_rule":{"enabled":false,"threshold":12}}`))
	if s.KidsRule.Enabled || s.KidsRule.Threshold != 12 {
		t.Errorf("kids rule: %+v", s.KidsRule)
	}
	if setup := b.valid("GET", "/setup", "").Body; !strings.Contains(setup, `"profiles":"done"`) {
		t.Errorf("setup after saving the Kids rule: %s", setup)
	}
}
