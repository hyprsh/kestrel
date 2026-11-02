package api_test

import (
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
)

type recipeSuggestionJSON struct {
	Name          string   `json:"name"`
	ReleaseFamily string   `json:"release_family"`
	Resolution    string   `json:"resolution"`
	LanguageRule  string   `json:"language_rule"`
	Kinds         []string `json:"kinds"`
}

type recipeSuggestionsJSON struct {
	Groups []struct {
		ReleaseFamily string           `json:"release_family"`
		Name          string           `json:"name"`
		Items         []recipeSuggestionJSON `json:"items"`
	} `json:"groups"`
}

func (s recipeSuggestionsJSON) all(t *testing.T) map[string]recipeSuggestionJSON {
	t.Helper()
	m := map[string]recipeSuggestionJSON{}
	for _, g := range s.Groups {
		for _, i := range g.Items {
			if i.ReleaseFamily != g.ReleaseFamily {
				t.Errorf("%s is in the %s group", i.Name, g.ReleaseFamily)
			}
			m[i.Name] = i
		}
	}
	return m
}

func recipeSuggestions(t *testing.T, b *browser) recipeSuggestionsJSON {
	t.Helper()
	return decode[recipeSuggestionsJSON](t, b.valid("GET", "/profiles/suggestions", ""))
}

func setPrimary(t *testing.T, b *browser, lang string) {
	t.Helper()
	b.valid("PATCH", "/settings", `{"language_region":{"primary_language":"`+lang+`"}}`)
	b.trashPass(t)
}

type warningJSON struct {
	Code     string   `json:"code"`
	Message  string   `json:"message"`
	Profiles []string `json:"profiles"`
}

func settingsWarnings(t *testing.T, b *browser) []warningJSON {
	t.Helper()
	return decode[struct {
		Warnings []warningJSON `json:"warnings"`
	}](t, b.valid("GET", "/settings", "")).Warnings
}

func profileMapAll(t *testing.T, b *browser) map[string]profileJSON {
	t.Helper()
	list := decode[struct {
		Items []profileJSON `json:"items"`
	}](t, b.valid("GET", "/profiles", ""))
	m := map[string]profileJSON{}
	for _, p := range list.Items {
		m[p.Key] = p
	}
	return m
}

func TestAFreshEnglishHouseholdIsOfferedRemuxWebAndSQPForMoviesOnly(t *testing.T) {
	t.Parallel()
	b := newLibraryInstance(t, metadatatest.Key)
	got := recipeSuggestions(t, b.browser)
	m := got.all(t)
	for _, name := range []string{"HD Remux", "4K Remux", "WEB 1080p", "WEB 2160p"} {
		if s, ok := m[name]; !ok || len(s.Kinds) != 2 {
			t.Errorf("%s = %+v (listed %v), want both kinds", name, s, ok)
		}
	}
	for _, name := range []string{"SQP 1080p", "SQP 2160p"} {
		if s, ok := m[name]; !ok || len(s.Kinds) != 1 || s.Kinds[0] != "movie" {
			t.Errorf("%s = %+v (listed %v), want Movies only", name, s, ok)
		}
	}
	for name := range m {
		if strings.Contains(name, "English") {
			t.Errorf("%s listed: it duplicates the Primary Language", name)
		}
	}
	for _, name := range []string{"HD", "4K", "HD Original", "Any"} {
		if _, ok := m[name]; ok {
			t.Errorf("%s listed, but the household has it", name)
		}
	}
	if s := m["HD French"]; s.LanguageRule != "fr" || s.ReleaseFamily != "bluray-web" || s.Resolution != "hd" {
		t.Errorf("HD French = %+v", s)
	}
	if len(got.Groups) < 2 || got.Groups[0].ReleaseFamily != "bluray-web" || got.Groups[1].ReleaseFamily != "remux-web" {
		t.Errorf("groups out of order: %+v", got.Groups)
	}
}

func TestAGermanHouseholdIsNotOfferedPrimaryWebAndAFrenchOneRemuxForMoviesOnly(t *testing.T) {
	t.Parallel()
	b := newLibraryInstance(t, metadatatest.Key)
	setPrimary(t, b.browser, "de")
	for name, s := range recipeSuggestions(t, b.browser).all(t) {
		if s.ReleaseFamily == "web" && s.LanguageRule == "primary" {
			t.Errorf("%s listed for a German household", name)
		}
	}
	setPrimary(t, b.browser, "fr")
	m := recipeSuggestions(t, b.browser).all(t)
	if s, ok := m["HD Remux"]; !ok || len(s.Kinds) != 1 || s.Kinds[0] != "movie" {
		t.Errorf("French HD Remux = %+v (listed %v), want Movies only", s, ok)
	}
}

func TestImportingARecipeCreatesAnEnabledProfileOnce(t *testing.T) {
	t.Parallel()
	b := newLibraryInstance(t, metadatatest.Key)
	r := b.valid("POST", "/profiles", `{"release_family":"remux-web","resolution":"uhd","language_rule":"primary"}`)
	if r.Status != 201 {
		t.Fatalf("import = %d %s", r.Status, r.Body)
	}
	p := decode[profileJSON](t, r)
	if p.Name != "4K Remux" || !p.Enabled || p.ReleaseFamily != "remux-web" || p.MinHeight != 2160 || p.TrashProfileMovies != "remux-web-2160p" || len(p.Kinds) != 2 {
		t.Errorf("imported = %+v", p)
	}
	if r := b.valid("POST", "/profiles", `{"release_family":"remux-web","resolution":"uhd","language_rule":"primary"}`); r.Status != 409 {
		t.Errorf("import again = %d %s, want 409", r.Status, r.Body)
	}
	if _, ok := recipeSuggestions(t, b.browser).all(t)["4K Remux"]; ok {
		t.Error("4K Remux still listed after the import")
	}
	if r := b.valid("PATCH", "/profiles/"+p.Key, `{"name":"My 4K"}`); r.Status != 200 {
		t.Errorf("rename = %d %s", r.Status, r.Body)
	}
	if r := b.valid("POST", "/profiles", `{"name":"Copy","copy_from":"hd-primary"}`); r.Status != 201 {
		t.Errorf("copy = %d %s", r.Status, r.Body)
	}
	for _, body := range []string{
		`{"release_family":"remux-web","resolution":"any","language_rule":"primary"}`,
		`{"release_family":"remux-web","resolution":"uhd"}`,
		`{"name":"x","copy_from":"hd-primary","release_family":"web","resolution":"hd","language_rule":"primary"}`,
		`{"release_family":"sqp","resolution":"hd","language_rule":"de"}`,
	} {
		if r := b.valid("POST", "/profiles", body); r.Status != 422 {
			t.Errorf("POST %s = %d %s, want 422", body, r.Status, r.Body)
		}
	}
}

func TestImportAnswers409WhileTheConfigFileDeclaresProfiles(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	in.mustDeclare(declaredProfiles)
	b := in.setUp()
	if r := b.valid("POST", "/profiles", `{"release_family":"web","resolution":"hd","language_rule":"primary"}`); r.Status != 409 {
		t.Errorf("import = %d %s, want 409", r.Status, r.Body)
	}
}

func TestSwitchingToALanguageAProfileNamesKeepsBothAndWarns(t *testing.T) {
	t.Parallel()
	b := newLibraryInstance(t, metadatatest.Key)
	setPrimary(t, b.browser, "de")
	r := b.valid("POST", "/profiles", `{"release_family":"bluray-web","resolution":"hd","language_rule":"en"}`)
	if r.Status != 201 {
		t.Fatalf("import = %d %s", r.Status, r.Body)
	}
	named := decode[profileJSON](t, r)
	if named.Name != "HD English" {
		t.Errorf("name = %q", named.Name)
	}
	if w := settingsWarnings(t, b.browser); len(w) != 0 {
		t.Fatalf("warnings before the switch: %+v", w)
	}
	setPrimary(t, b.browser, "en")
	w := settingsWarnings(t, b.browser)
	if len(w) != 1 || w[0].Code != "duplicate_profile" || len(w[0].Profiles) != 2 || !strings.Contains(w[0].Message, "HD English") {
		t.Fatalf("warnings = %+v", w)
	}
	m := profileMapAll(t, b.browser)
	if !m[named.Key].Enabled || !m["hd-primary"].Enabled {
		t.Error("a Profile was disabled or merged")
	}
	// A plain copy is the same recipe on purpose and draws no warning.
	b.valid("POST", "/profiles", `{"name":"4K copy","copy_from":"4k-primary"}`)
	if got := settingsWarnings(t, b.browser); len(got) != 1 {
		t.Errorf("warnings after a copy = %+v", got)
	}
}
