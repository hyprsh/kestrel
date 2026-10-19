package api_test

import (
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
