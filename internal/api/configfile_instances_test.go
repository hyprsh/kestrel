package api_test

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/app"
	"github.com/hyprsh/kestrel/internal/plugin"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
	dcfake "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1/fake"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	ixfake "github.com/hyprsh/kestrel/internal/plugin/indexer/v1/fake"
)

// withFakes registers the in-memory download client ("fake", key "sk") and
// indexer ("fake_indexer", key "ik").
func withFakes(t *testing.T) func(*app.Options) {
	reg := plugin.NewRegistry()
	if err := reg.Register(downloadclient.Contract, dcfake.New("sk")); err != nil {
		t.Fatal(err)
	}
	if err := reg.Register(indexer.Contract, ixfake.New("ik")); err != nil {
		t.Fatal(err)
	}
	return func(o *app.Options) { o.Plugins = reg }
}

// fakeEnv holds the secrets declaredInstances names.
var fakeEnv = []string{"KESTREL_ADMIN_PASSWORD", "correct horse", "CLIENT_KEY", "sk", "INDEXER_KEY", "ik"}

const declaredInstances = `plugin_instances:
  - name: SABnzbd
    plugin_id: fake
    enabled: true
    priority: 0
    config:
      api_key_env: CLIENT_KEY
      movie_category: films
  - name: Alpha
    plugin_id: fake_indexer
    enabled: true
    priority: 5
    config:
      api_key_env: INDEXER_KEY
      api_requests_per_day: 100
`

func instancesByName(t *testing.T, b *browser) map[string]instanceJSON {
	t.Helper()
	list := decode[struct {
		Items []instanceJSON `json:"items"`
	}](t, b.valid("GET", "/plugin-instances", ""))
	out := map[string]instanceJSON{}
	for _, i := range list.Items {
		out[i.Name] = i
	}
	return out
}

func TestAFreshStartWithACompleteFileNeedsNoAPICall(t *testing.T) {
	in := newInstance(t, "", withFakes(t))
	data := t.TempDir()
	mkdirs(t, data+"/movies", data+"/movies-4k", data+"/tv")
	in.mustDeclare(settingsFile(data)+declaredProfiles+declaredInstances, fakeEnv...)
	b := in.login()

	got := instancesByName(t, b)
	if c := got["SABnzbd"]; c.PluginID != "fake" || !c.Enabled || c.Config["movie_category"] != "films" || strings.Join(c.SecretsSet, ",") != "api_key" {
		t.Errorf("client = %+v", c)
	}
	if i := got["Alpha"]; i.PluginID != "fake_indexer" || !i.Enabled || i.Priority != 5 || i.Config["api_requests_per_day"] != float64(100) {
		t.Errorf("indexer = %+v", i)
	}
	if s := b.valid("GET", "/setup", ""); !strings.Contains(s.Body, `"completed":true`) {
		t.Errorf("setup = %s, want completed", s.Body)
	}
}

func TestASecondStartWithTheSameInstancesWritesNothing(t *testing.T) {
	in := newInstance(t, "", withFakes(t))
	in.mustDeclare(declaredAccount+declaredProfiles+declaredInstances, fakeEnv...)

	in.restart()
	before := in.writes()
	if err := in.app.EnforceConfigFile(context.Background()); err != nil {
		t.Fatal(err)
	}
	if after := in.writes(); after != before {
		t.Errorf("the second start changed %d rows", after-before)
	}
}

// uiClient creates a download client in the UI and returns it.
func uiClient(t *testing.T, b *browser, name string, enabled bool) instanceJSON {
	t.Helper()
	r := b.valid("POST", "/plugin-instances", `{"plugin_id":"fake","name":"`+name+`","enabled":`+strconv.FormatBool(enabled)+`,"config":{"api_key":"sk"}}`)
	if r.Status != 201 {
		t.Fatalf("POST /plugin-instances = %d %s", r.Status, r.Body)
	}
	return decode[instanceJSON](t, r)
}

func TestAChangedInstanceIsUpdatedInPlaceAndARemovedOneDeleted(t *testing.T) {
	in := newInstance(t, "", withFakes(t))
	in.mustDeclare(declaredAccount+declaredInstances, fakeEnv...)
	b := in.login()
	ui := uiClient(t, b, "Spare", false)
	first := instancesByName(t, b)

	changed := strings.NewReplacer("movie_category: films", "movie_category: cinema", "priority: 5", "priority: 9").Replace(declaredInstances)
	in.mustDeclare(declaredAccount+changed, fakeEnv...)
	got := instancesByName(t, b)
	if c := got["SABnzbd"]; c.ID != first["SABnzbd"].ID || c.Config["movie_category"] != "cinema" {
		t.Errorf("client = %+v, want id %d with the new category", c, first["SABnzbd"].ID)
	}
	if i := got["Alpha"]; i.ID != first["Alpha"].ID || i.Priority != 9 {
		t.Errorf("indexer = %+v, want id %d with priority 9", i, first["Alpha"].ID)
	}

	onlyIndexer := declaredInstances[:strings.Index(declaredInstances, "  - name: SABnzbd")] + declaredInstances[strings.Index(declaredInstances, "  - name: Alpha"):]
	in.mustDeclare(declaredAccount+onlyIndexer, fakeEnv...)
	got = instancesByName(t, b)
	if _, ok := got["SABnzbd"]; ok {
		t.Error("the client left the file but is still there")
	}
	if s := got["Spare"]; s.ID != ui.ID || s.Enabled {
		t.Errorf("the UI's instance = %+v, want it untouched", s)
	}
	if _, ok := got["Alpha"]; !ok {
		t.Error("the indexer is gone")
	}
}

func TestARenamedInstanceIsANewOne(t *testing.T) {
	in := newInstance(t, "", withFakes(t))
	in.mustDeclare(declaredAccount+declaredInstances, fakeEnv...)
	b := in.login()
	old := instancesByName(t, b)["Alpha"]
	uiClient(t, b, "Spare", false) // so the store does not hand Alpha's id out again

	in.mustDeclare(declaredAccount+strings.Replace(declaredInstances, "name: Alpha", "name: Beta", 1), fakeEnv...)
	got := instancesByName(t, b)
	if _, ok := got["Alpha"]; ok {
		t.Error("the old name is still there")
	}
	if n, ok := got["Beta"]; !ok || n.ID == old.ID {
		t.Errorf("Beta = %+v, want a new instance", n)
	}
}

func TestTwoDeclaredDownloadClientsSwapWhichIsEnabled(t *testing.T) {
	in := newInstance(t, "", withFakes(t))
	backup := "  - name: Backup\n    plugin_id: fake\n    enabled: %v\n    config:\n      api_key_env: CLIENT_KEY\n"
	in.mustDeclare(declaredAccount+declaredInstances+fmt.Sprintf(backup, false), fakeEnv...)

	swapped := strings.Replace(declaredInstances, "plugin_id: fake\n    enabled: true", "plugin_id: fake\n    enabled: false", 1) + fmt.Sprintf(backup, true)
	in.mustDeclare(declaredAccount+swapped, fakeEnv...)
	got := instancesByName(t, in.login())
	if got["SABnzbd"].Enabled || !got["Backup"].Enabled {
		t.Errorf("SABnzbd enabled = %v, Backup enabled = %v, want them swapped", got["SABnzbd"].Enabled, got["Backup"].Enabled)
	}
}

func TestAUIInstanceWithADeclaredNameIsTakenOver(t *testing.T) {
	in := newInstance(t, "", withFakes(t))
	b := in.setUp()
	ui := uiClient(t, b, "SABnzbd", true)

	in.mustDeclare(declaredInstances, fakeEnv...)
	got := instancesByName(t, b)
	if c := got["SABnzbd"]; c.ID != ui.ID || c.Config["movie_category"] != "films" {
		t.Errorf("client = %+v, want id %d brought to the file", c, ui.ID)
	}
	if n := len(got); n != 2 {
		t.Errorf("%d instances, want 2: %v", n, got)
	}

	// Taken over, it is declared: leaving the file deletes it.
	in.mustDeclare("plugin_instances: []\n")
	if got := instancesByName(t, b); len(got) != 0 {
		t.Errorf("instances = %v, want none", got)
	}
}

func TestAnAmbiguousTakeoverFailsStartup(t *testing.T) {
	for _, c := range []struct {
		name string
		ui   func(*testing.T, *browser)
		want string
	}{
		{"two of the name", func(t *testing.T, b *browser) {
			uiClient(t, b, "SABnzbd", false)
			uiClient(t, b, "SABnzbd", false)
		}, `plugin_instances "SABnzbd": name`},
		{"another plugin", func(t *testing.T, b *browser) {
			if r := b.valid("POST", "/plugin-instances", `{"plugin_id":"fake_indexer","name":"SABnzbd","config":{"api_key":"ik"}}`); r.Status != 201 {
				t.Fatalf("POST = %d %s", r.Status, r.Body)
			}
		}, `plugin_instances "SABnzbd": plugin_id`},
	} {
		t.Run(c.name, func(t *testing.T) {
			in := newInstance(t, "", withFakes(t))
			b := in.setUp()
			c.ui(t, b)
			before := instancesByName(t, b)

			err := in.declare(declaredInstances, fakeEnv...)
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("err = %v, want one with %s", err, c.want)
			}
			if after := instancesByName(t, b); len(after) != len(before) {
				t.Errorf("instances = %v, want them as they were", after)
			}
		})
	}
}

func TestADeclaredClientOverTheEnabledCapFailsStartupNamingBoth(t *testing.T) {
	in := newInstance(t, "", withFakes(t))
	b := in.setUp()
	uiClient(t, b, "Old SAB", true)

	err := in.declare(declaredInstances, fakeEnv...)
	if err == nil || !strings.Contains(err.Error(), `"SABnzbd"`) || !strings.Contains(err.Error(), `"Old SAB"`) {
		t.Fatalf("err = %v, want one naming both clients", err)
	}
	got := instancesByName(t, b)
	if len(got) != 1 || !got["Old SAB"].Enabled {
		t.Errorf("instances = %v, want the UI's client alone and enabled", got)
	}

	// Declared disabled, it fits beside the UI's.
	in.mustDeclare(strings.Replace(declaredInstances, "enabled: true", "enabled: false", 1), fakeEnv...)
}

func TestAnInvalidInstanceFailsStartupWithoutItsSecret(t *testing.T) {
	for _, c := range []struct {
		name, body string
		env        []string
		want       []string
	}{
		{"inline secret", strings.Replace(declaredInstances, "api_key_env: CLIENT_KEY", "api_key: hunter2-secret", 1), fakeEnv,
			[]string{`plugin_instances "SABnzbd"`, "config.api_key", "api_key_env"}},
		{"unknown config key", strings.Replace(declaredInstances, "movie_category: films", "tv_category: hunter2-secret", 1), fakeEnv,
			[]string{`plugin_instances "SABnzbd"`, "config.tv_category", "unknown key"}},
		{"unset variable", declaredInstances, []string{"KESTREL_ADMIN_PASSWORD", "correct horse", "CLIENT_KEY", "hunter2-secret"},
			[]string{`plugin_instances "Alpha"`, "INDEXER_KEY"}},
		{"unknown plugin", strings.Replace(declaredInstances, "plugin_id: fake_indexer", "plugin_id: nzbhydra", 1), fakeEnv,
			[]string{`plugin_instances "Alpha"`, "plugin_id"}},
		{"invalid value", strings.Replace(declaredInstances, "api_requests_per_day: 100", "api_requests_per_day: lots", 1), fakeEnv,
			[]string{`plugin_instances "Alpha"`, "config.api_requests_per_day"}},
		{"two enabled clients", declaredInstances + "  - name: Backup\n    plugin_id: fake\n    config:\n      api_key_env: CLIENT_KEY\n", fakeEnv,
			[]string{`"SABnzbd"`, `"Backup"`, "enabled"}},
	} {
		t.Run(c.name, func(t *testing.T) {
			in := newInstance(t, "", withFakes(t))
			err := in.declare(declaredAccount+declaredProfiles+c.body, c.env...)
			if err == nil {
				t.Fatal("startup did not fail")
			}
			for _, w := range c.want {
				if !strings.Contains(err.Error(), w) {
					t.Errorf("err = %v, want %q in it", err, w)
				}
			}
			if strings.Contains(err.Error(), "hunter2") || strings.Contains(err.Error(), `"sk"`) {
				t.Errorf("the error carries a secret: %v", err)
			}
			if s := in.browser().valid("GET", "/setup", ""); !strings.Contains(s.Body, `"account_exists":false`) {
				t.Errorf("setup = %s, want nothing written", s.Body)
			}
		})
	}
}

func TestADeclaredInstanceThatFailsItsTestIsOnlyLogged(t *testing.T) {
	var log bytes.Buffer
	in := newInstance(t, "", withFakes(t), func(o *app.Options) {
		o.Logger = slog.New(slog.NewTextHandler(&log, nil))
	})
	env := slices.Clone(fakeEnv)
	env[slices.Index(env, "CLIENT_KEY")+1] = "wrong-key"
	in.mustDeclare(declaredAccount+declaredInstances, env...)

	if !strings.Contains(log.String(), "SABnzbd") || strings.Contains(log.String(), "wrong-key") {
		t.Errorf("log = %s, want the failing instance named without its key", log.String())
	}
	if strings.Contains(log.String(), "Alpha") {
		t.Errorf("log = %s, want only the failing instance", log.String())
	}
}

func TestAnInstanceTheUIRenamedWhileUndeclaredIsKeptWhenTheSectionReturns(t *testing.T) {
	for _, c := range []struct {
		name  string
		leave func(*instance)
	}{
		{"a file without the section", func(in *instance) { in.mustDeclare(declaredRegion) }},
		{"no file", func(in *instance) { in.opts.ConfigFile = nil; in.restart() }},
	} {
		t.Run(c.name, func(t *testing.T) { renameWhileUndeclared(t, c.leave) })
	}
}

func renameWhileUndeclared(t *testing.T, leave func(*instance)) {
	in := newInstance(t, "", withFakes(t))
	b := in.setUp()
	in.mustDeclare(declaredInstances, fakeEnv...)
	first := instancesByName(t, b)
	leave(in)

	sab := strconv.FormatInt(first["SABnzbd"].ID, 10)
	if r := b.valid("PATCH", "/plugin-instances/"+sab, `{"name":"Mine","enabled":false}`); r.Status != 200 {
		t.Fatalf("renaming in the UI = %d %s", r.Status, r.Body)
	}
	alpha := strconv.FormatInt(first["Alpha"].ID, 10)
	if r := b.valid("PATCH", "/plugin-instances/"+alpha, `{"priority":7}`); r.Status != 200 {
		t.Fatalf("editing in the UI = %d %s", r.Status, r.Body)
	}

	in.mustDeclare(declaredInstances, fakeEnv...)
	got := instancesByName(t, b)
	if m, ok := got["Mine"]; !ok || m.ID != first["SABnzbd"].ID || m.FromConfigFile {
		t.Errorf("the instance renamed in the UI = %+v (present %v), want it kept as the UI's", m, ok)
	}
	if s := got["SABnzbd"]; s.ID == first["SABnzbd"].ID || !s.FromConfigFile {
		t.Errorf("SABnzbd = %+v, want a new declared instance", s)
	}
	if a := got["Alpha"]; a.ID != first["Alpha"].ID || a.Priority != 5 || !a.FromConfigFile {
		t.Errorf("Alpha = %+v, want it taken over and brought back to the file", a)
	}
}

func TestASecondInstanceTheUIGaveADeclaredNameWhileUndeclaredMakesTheReturnAmbiguous(t *testing.T) {
	in := newInstance(t, "", withFakes(t))
	b := in.setUp()
	in.mustDeclare(declaredInstances, fakeEnv...)
	in.mustDeclare(declaredRegion)
	uiClient(t, b, "SABnzbd", false)

	err := in.declare(declaredInstances, fakeEnv...)
	if err == nil || !strings.Contains(err.Error(), `plugin_instances "SABnzbd": name`) {
		t.Fatalf("err = %v, want the takeover to be ambiguous", err)
	}
}
