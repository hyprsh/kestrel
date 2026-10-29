package api_test

import (
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/plextv/plextvtest"
	"github.com/hyprsh/kestrel/internal/plugin"
	mediaserver "github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1"
	"github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1/fake"
)

const siloToken = "silo-key"

type siloJSON struct {
	WatchAhead     bool    `json:"watch_ahead"`
	Instance       *string `json:"instance"`
	FromConfigFile bool    `json:"from_config_file"`
}

// silo is a media server of plugin id `silo`, as far as the settings go.
type silo struct{ *fake.Server }

func (silo) Describe() plugin.Manifest {
	m := fake.New("").Describe()
	m.ID = "silo"
	return m
}

// registerSilo makes the plugin `silo` known to the household's Kestrel.
func (h *plexHousehold) registerSilo() {
	h.t.Helper()
	if err := h.opts.Plugins.Register(mediaserver.Contract, silo{fake.New(siloToken)}); err != nil {
		h.t.Fatal(err)
	}
}

// addSilo registers the plugin and adds an instance of it, named name.
func (h *plexHousehold) addSilo(name string) {
	h.t.Helper()
	h.registerSilo()
	body := `{"plugin_id":"silo","name":"` + name + `","config":{"token":"` + siloToken + `"}}`
	if r := h.sendBody(h.admin, "POST", "/plugin-instances", body); r.Status != 201 {
		h.t.Fatalf("silo instance = %d %s", r.Status, r.Body)
	}
}

func (h *plexHousehold) putSilo(body string) {
	h.t.Helper()
	if r := h.sendBody(h.admin, "PUT", "/settings/silo", body); r.Status != 200 {
		h.t.Fatalf("PUT /settings/silo = %d %s", r.Status, r.Body)
	}
}

func TestSiloSettingsAreOffUntilSavedAndAreReadBack(t *testing.T) {
	t.Parallel()
	h := newHousehold(t, "")
	h.addSilo("Silo")
	got := decode[siloJSON](t, h.admin.valid("GET", "/settings/silo", ""))
	if got.WatchAhead || got.Instance != nil || got.FromConfigFile {
		t.Fatalf("settings = %+v, want off and unset", got)
	}
	h.putSilo(`{"watch_ahead":true,"instance":" Silo "}`)
	got = decode[siloJSON](t, h.admin.valid("GET", "/settings/silo", ""))
	if !got.WatchAhead || got.Instance == nil || *got.Instance != "Silo" {
		t.Fatalf("settings = %+v, want Watch-ahead on with the instance trimmed", got)
	}
	// An instance may be named while Watch-ahead is off, and none is needed then.
	h.putSilo(`{"watch_ahead":false,"instance":"Silo"}`)
	h.putSilo(`{"watch_ahead":false,"instance":null}`)
	if got = decode[siloJSON](t, h.admin.valid("GET", "/settings/silo", "")); got.WatchAhead || got.Instance != nil {
		t.Errorf("settings = %+v, want off and unset", got)
	}
}

func TestSiloSettingsAreValidated(t *testing.T) {
	t.Parallel()
	h := newHousehold(t, "")
	h.addSilo("Silo")
	for _, c := range []struct{ name, body, code string }{
		{"Watch-ahead without an instance", `{"watch_ahead":true,"instance":null}`, "required"},
		{"Watch-ahead with a blank instance", `{"watch_ahead":true,"instance":"  "}`, "required"},
		{"an instance that does not exist", `{"watch_ahead":false,"instance":"Gone"}`, "not_found"},
		{"a Plex instance", `{"watch_ahead":true,"instance":"Plex"}`, "wrong_plugin"},
	} {
		r := h.admin.valid("PUT", "/settings/silo", c.body)
		if r.Status != 422 || !strings.Contains(r.Body, `"field":"instance"`) || !strings.Contains(r.Body, `"code":"`+c.code+`"`) {
			t.Errorf("%s = %d %s, want 422 instance/%s", c.name, r.Status, r.Body, c.code)
		}
	}
	if got := decode[siloJSON](t, h.admin.valid("GET", "/settings/silo", "")); got.WatchAhead || got.Instance != nil {
		t.Errorf("settings = %+v, want the rejected ones unsaved", got)
	}
	if r := h.admin.valid("PUT", "/settings/silo", ""); r.Status != 400 && r.Status != 422 {
		t.Errorf("PUT without a body = %d", r.Status)
	}
}

func TestOnlyTheAdminChangesSiloSettings(t *testing.T) {
	t.Parallel()
	h := newHousehold(t, "")
	b := h.requester("anna-token")
	for _, c := range []struct{ method, body string }{{"GET", ""}, {"PUT", `{"watch_ahead":false,"instance":null}`}} {
		if r := b.do(c.method, "/settings/silo", c.body); r.Status != 403 || !strings.Contains(r.Body, `"code":"forbidden"`) {
			t.Errorf("%s /settings/silo as a Requester = %d %s, want 403 forbidden", c.method, r.Status, r.Body)
		}
	}
}

func TestADeclaredSiloIsAppliedAndReadOnly(t *testing.T) {
	t.Parallel()
	tv := plextvtest.New(t)
	in := newInstance(t, "", withPlex(t, tv))
	if err := in.opts.Plugins.Register(mediaserver.Contract, silo{fake.New(siloToken)}); err != nil {
		t.Fatal(err)
	}
	household(t, in, tv)

	// A declared section is checked against the instances the file declares.
	declared := declaredPlex(tv.URL) + `  - name: Silo
    plugin_id: silo
    config:
      token_env: SILO_TOKEN
`
	if err := in.declare(declared+"silo:\n  watch_ahead: true\n  instance: Plex\n", "PLEX_TOKEN", plextvtest.OwnerToken, "SILO_TOKEN", siloToken); err == nil || !strings.Contains(err.Error(), "silo.instance") {
		t.Fatalf("Silo naming a Plex instance: err = %v, want one naming silo.instance", err)
	}
	if err := in.declare(declared+"silo:\n  watch_ahead: true\n", "PLEX_TOKEN", plextvtest.OwnerToken, "SILO_TOKEN", siloToken); err == nil || !strings.Contains(err.Error(), "silo.instance") {
		t.Fatalf("Watch-ahead without an instance: err = %v, want one naming silo.instance", err)
	}

	in.mustDeclare(declared+"silo:\n  watch_ahead: true\n  instance: Silo\n", "PLEX_TOKEN", plextvtest.OwnerToken, "SILO_TOKEN", siloToken, "KESTREL_ADMIN_PASSWORD", "correct horse")
	b, r := in.loginAs("admin", "correct horse")
	if r.Status != 204 {
		t.Fatalf("login = %d %s", r.Status, r.Body)
	}
	got := decode[siloJSON](t, b.valid("GET", "/settings/silo", ""))
	if !got.WatchAhead || !got.FromConfigFile || got.Instance == nil || *got.Instance != "Silo" {
		t.Fatalf("settings = %+v", got)
	}
	in.conflictNamingTheFile("PUT /settings/silo", b.valid("PUT", "/settings/silo", `{"watch_ahead":false,"instance":null}`))

	// Leaving the section out hands it back to the UI, with what was declared kept.
	in.mustDeclare(declared, "PLEX_TOKEN", plextvtest.OwnerToken, "SILO_TOKEN", siloToken)
	b, _ = in.loginAs("admin", "correct horse")
	if got = decode[siloJSON](t, b.valid("GET", "/settings/silo", "")); got.FromConfigFile || !got.WatchAhead {
		t.Errorf("after leaving the section out: %+v", got)
	}
	if r := b.valid("PUT", "/settings/silo", `{"watch_ahead":false,"instance":null}`); r.Status != 200 {
		t.Errorf("PUT once the file leaves it out = %d %s", r.Status, r.Body)
	}
}
