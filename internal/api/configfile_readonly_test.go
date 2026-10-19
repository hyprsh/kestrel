package api_test

import (
	"strconv"
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

func TestADeclaredAccountIsReadOnly(t *testing.T) {
	in := newInstance(t, "")
	if me := in.setUp().valid("GET", "/auth/me", ""); !strings.Contains(me.Body, `"from_config_file":false`) {
		t.Errorf("without a Config File: %s, want from_config_file false", me.Body)
	}
	in.mustDeclare(declaredAccount, "KESTREL_ADMIN_PASSWORD", "correct horse")
	b := in.login()

	if me := b.valid("GET", "/auth/me", ""); !strings.Contains(me.Body, `"from_config_file":true`) {
		t.Errorf("declared: %s, want from_config_file true", me.Body)
	}
	in.conflictNamingTheFile("POST /account/password",
		b.valid("POST", "/account/password", `{"current_password":"correct horse","new_password":"battery staple"}`))
	in.conflictNamingTheFile("POST /setup/account", b.valid("POST", "/setup/account", adminJSON))
	if _, r := in.loginAs("admin", "correct horse"); r.Status != 204 {
		t.Errorf("login with the declared password = %d, want 204", r.Status)
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

// uiIndexer is a POST /plugin-instances body for a fake indexer named name.
func uiIndexer(name string) string {
	return `{"plugin_id":"fake_indexer","name":"` + name + `","enabled":false,"config":{"api_key":"ik"}}`
}

func TestADeclaredInstanceIsReadOnly(t *testing.T) {
	in := newInstance(t, "", withFakes(t))
	b := in.setUp()
	ui := decode[instanceJSON](t, b.valid("POST", "/plugin-instances", uiIndexer("Beta")))
	if ui.FromConfigFile {
		t.Errorf("without a Config File: %+v, want from_config_file false", ui)
	}
	in.mustDeclare(declaredInstances, fakeEnv...)

	got := instancesByName(t, b)
	declared := got["Alpha"]
	if !declared.FromConfigFile || got["SABnzbd"].FromConfigFile != true || got["Beta"].FromConfigFile {
		t.Errorf("from_config_file: %+v, want Alpha and SABnzbd only", got)
	}
	id := strconv.FormatInt(declared.ID, 10)
	if one := decode[instanceJSON](t, b.valid("GET", "/plugin-instances/"+id, "")); !one.FromConfigFile {
		t.Errorf("GET one = %+v, want from_config_file", one)
	}
	in.conflictNamingTheFile("PATCH a declared instance", b.valid("PATCH", "/plugin-instances/"+id, `{"enabled":false}`))
	in.conflictNamingTheFile("DELETE a declared instance", b.valid("DELETE", "/plugin-instances/"+id, ""))
	if after := instancesByName(t, b)["Alpha"]; !after.Enabled {
		t.Errorf("Alpha after the refused writes = %+v, want it unchanged", after)
	}
	if r := b.valid("POST", "/plugin-instances/"+id+"/test", "{}"); r.Status != 200 {
		t.Errorf("testing a declared instance = %d %s, want 200", r.Status, r.Body)
	}

	in.conflictNamingTheFile("POST with a declared name", b.valid("POST", "/plugin-instances", uiIndexer(" Alpha ")))
	uiID := strconv.FormatInt(ui.ID, 10)
	in.conflictNamingTheFile("rename to a declared name", b.valid("PATCH", "/plugin-instances/"+uiID, `{"name":"SABnzbd"}`))

	if r := b.valid("POST", "/plugin-instances", uiIndexer("Beta")); r.Status != 201 {
		t.Errorf("a second UI instance named Beta = %d %s, want 201", r.Status, r.Body)
	}
	if r := b.valid("PATCH", "/plugin-instances/"+uiID, `{"name":"Gamma"}`); r.Status != 200 {
		t.Errorf("renaming a UI instance = %d %s, want 200", r.Status, r.Body)
	}
	if r := b.valid("DELETE", "/plugin-instances/"+uiID, ""); r.Status != 204 {
		t.Errorf("deleting a UI instance = %d %s, want 204", r.Status, r.Body)
	}
}

func TestInstancesGoBackToTheUIWhenTheFileStopsDeclaringThem(t *testing.T) {
	in := newInstance(t, "", withFakes(t))
	b := in.setUp()
	in.mustDeclare(declaredInstances, fakeEnv...)
	in.mustDeclare(declaredRegion)

	alpha := instancesByName(t, b)["Alpha"]
	if alpha.FromConfigFile {
		t.Errorf("Alpha once the file leaves plugin_instances out = %+v, want from_config_file false", alpha)
	}
	if r := b.valid("PATCH", "/plugin-instances/"+strconv.FormatInt(alpha.ID, 10), `{"priority":7}`); r.Status != 200 {
		t.Errorf("PATCH = %d %s, want 200", r.Status, r.Body)
	}
}
