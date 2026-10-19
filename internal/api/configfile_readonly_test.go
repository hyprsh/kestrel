package api_test

import (
	"strings"
	"testing"
)

// conflictNamingTheFile fails unless r is a 409 conflict whose detail names
// the instance's Config File.
func (in *instance) conflictNamingTheFile(what string, r reply) {
	in.t.Helper()
	if r.Status != 409 || !strings.Contains(r.Body, `"code":"conflict"`) || !strings.Contains(r.Body, in.opts.ConfigFile.Path) {
		in.t.Errorf("%s = %d %s, want 409 conflict naming %s", what, r.Status, r.Body, in.opts.ConfigFile.Path)
	}
}

const declaredRegion = "language_region:\n  primary_language: de\n  release_date_country: AT\n"

type fromConfigFileSettings struct {
	FromConfigFile struct {
		LanguageRegion     bool `json:"language_region"`
		RootFolders        bool `json:"root_folders"`
		CheckGitHubUpdates bool `json:"check_github_updates"`
	} `json:"from_config_file"`
	LanguageRegion struct {
		PrimaryLanguage string `json:"primary_language"`
	} `json:"language_region"`
	Trash struct {
		AutoUpdate bool `json:"auto_update"`
	} `json:"trash"`
}

func TestADeclaredSettingsSectionIsReadOnly(t *testing.T) {
	in := newInstance(t, "")
	b := in.setUp()
	in.mustDeclare(declaredRegion)

	s := decode[fromConfigFileSettings](t, b.valid("GET", "/settings", ""))
	if f := s.FromConfigFile; !f.LanguageRegion || f.RootFolders || f.CheckGitHubUpdates {
		t.Errorf("from_config_file = %+v, want language_region only", f)
	}
	in.conflictNamingTheFile("PATCH language_region", b.valid("PATCH", "/settings", `{"language_region":{"primary_language":"en"},"trash":{"auto_update":false}}`))

	s = decode[fromConfigFileSettings](t, b.valid("GET", "/settings", ""))
	if s.LanguageRegion.PrimaryLanguage != "de" || !s.Trash.AutoUpdate {
		t.Errorf("after the refused patch: %+v, want nothing saved", s)
	}
	if r := b.valid("PATCH", "/settings", `{"check_github_updates":false,"trash":{"auto_update":false}}`); r.Status != 200 {
		t.Errorf("PATCH of undeclared sections = %d %s, want 200", r.Status, r.Body)
	}
}

func TestADeclaredReverseProxyIsReadOnly(t *testing.T) {
	in := newInstance(t, "")
	b := in.setUp()
	if r := b.valid("GET", "/settings/reverse-proxy", ""); !strings.Contains(r.Body, `"from_config_file":false`) {
		t.Errorf("without a Config File: %s, want from_config_file false", r.Body)
	}
	in.mustDeclare("reverse_proxy:\n  enabled: true\n  trusted_proxies: [10.0.0.1]\n  header: Remote-User\n")

	if r := b.valid("GET", "/settings/reverse-proxy", ""); !strings.Contains(r.Body, `"from_config_file":true`) {
		t.Errorf("declared: %s, want from_config_file true", r.Body)
	}
	in.conflictNamingTheFile("PUT /settings/reverse-proxy",
		b.valid("PUT", "/settings/reverse-proxy", `{"enabled":false,"trusted_proxies":[],"header":"Remote-User"}`))
	if r := b.valid("GET", "/settings/reverse-proxy", ""); !strings.Contains(r.Body, `"enabled":true`) {
		t.Errorf("after the refused PUT: %s, want it unchanged", r.Body)
	}
}

func TestDeclaredProfilesAreReadOnly(t *testing.T) {
	in := newInstance(t, "")
	b := in.setUp()
	if r := b.valid("GET", "/profiles", ""); strings.Contains(r.Body, `"from_config_file":true`) {
		t.Errorf("without a Config File: %s, want every from_config_file false", r.Body)
	}
	in.mustDeclare(declaredProfiles)

	if r := b.valid("GET", "/profiles", ""); strings.Contains(r.Body, `"from_config_file":false`) {
		t.Errorf("declared: %s, want every from_config_file true", r.Body)
	}
	in.conflictNamingTheFile("PATCH /profiles/any-original", b.valid("PATCH", "/profiles/any-original", `{"enabled":true}`))
	if got := profileMap(t, b)["any-original"]; got.Enabled {
		t.Errorf("any-original after the refused patch = %+v, want it still disabled", got)
	}
}
