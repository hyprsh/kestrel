package api_test

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/app"
	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/adapters/newznab"
	"github.com/hyprsh/kestrel/internal/plugin/adapters/sabnzbd"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
)

const nzbKey = "fedcba9876543210fedcba9876543210"

// fakeIndexer answers the Newznab calls the plugin API makes: caps and a one-result search.
func fakeIndexer(t *testing.T) *httptest.Server {
	t.Helper()
	read := func(name string) []byte {
		b, err := os.ReadFile(filepath.Join("..", "plugin", "adapters", "newznab", "testdata", name))
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		switch {
		case q.Get("t") == "caps":
			_, _ = w.Write(read("caps.xml"))
		case q.Get("apikey") != nzbKey:
			_, _ = w.Write(read("error_100.xml"))
		default:
			_, _ = w.Write(read("empty.xml"))
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func withSABAndNewznab(t *testing.T) func(*app.Options) {
	reg := plugin.NewRegistry()
	if err := reg.Register(downloadclient.Contract, sabnzbd.New(nil)); err != nil {
		t.Fatal(err)
	}
	if err := reg.Register(indexer.Contract, newznab.New(nil)); err != nil {
		t.Fatal(err)
	}
	return func(o *app.Options) { o.Plugins = reg }
}

func newznabBody(name, srvURL, key, extra string) string {
	return `{"plugin_id":"newznab","name":"` + name + `","config":{"url":"` + srvURL + `","api_key":"` + key + `"` + extra + `}}`
}

func TestConnectingNewznabIndexersEndToEnd(t *testing.T) {
	idx := fakeIndexer(t)
	b := newInstance(t, "", withSABAndNewznab(t)).setUp()

	if s := b.valid("GET", "/setup", ""); !strings.Contains(s.Body, `"indexer":"todo"`) {
		t.Fatalf("setup before any indexer: %s", s.Body)
	}

	// The live test: a bad key shows the error, a good one the indexer's name.
	r := b.valid("POST", "/plugin-instances/test", `{"plugin_id":"newznab","config":{"url":"`+idx.URL+`","api_key":"wrong"}}`)
	if res := decode[testJSON](t, r); res.OK || res.Code == nil || *res.Code != "auth" {
		t.Fatalf("bad key: %s", r.Body)
	}
	r = b.valid("POST", "/plugin-instances/test", `{"plugin_id":"newznab","config":{"url":"`+idx.URL+`","api_key":"`+nzbKey+`"}}`)
	if res := decode[testJSON](t, r); !res.OK || !strings.Contains(res.Message, "NZBgeek-like") {
		t.Fatalf("good key: %s", r.Body)
	}

	// Saving fills the category defaults and never echoes the key.
	r = b.valid("POST", "/plugin-instances", newznabBody("Geek", idx.URL, nzbKey, `,"api_requests_per_day":100`))
	if r.Status != 201 {
		t.Fatalf("create: %d %s", r.Status, r.Body)
	}
	first := decode[instanceJSON](t, r)
	if first.Contract != "indexer.v1" || !first.Enabled || first.Config["movie_categories"] != "2000" || first.Config["tv_categories"] != "5000" || first.Config["api_requests_per_day"] != float64(100) {
		t.Fatalf("%+v", first)
	}
	if _, has := first.Config["api_key"]; has || len(first.SecretsSet) != 1 || first.SecretsSet[0] != "api_key" {
		t.Fatalf("the key must be reported only as set: %+v", first)
	}

	// Many indexers may be enabled, ordered by priority.
	r = b.valid("POST", "/plugin-instances", strings.Replace(newznabBody("Second", idx.URL, nzbKey, ""), `"name"`, `"priority":5,"name"`, 1))
	if r.Status != 201 {
		t.Fatalf("a second enabled indexer: %d %s", r.Status, r.Body)
	}
	second := decode[instanceJSON](t, r)
	if second.Priority != 5 || !second.Enabled {
		t.Fatalf("%+v", second)
	}

	// Disable, edit and remove.
	id := "/plugin-instances/" + itoa(second.ID)
	r = b.valid("PATCH", id, `{"enabled":false,"name":"Renamed","priority":1,"config":{"tv_categories":"5040"}}`)
	got := decode[instanceJSON](t, r)
	if r.Status != 200 || got.Enabled || got.Name != "Renamed" || got.Priority != 1 || got.Config["tv_categories"] != "5040" || len(got.SecretsSet) != 1 {
		t.Fatalf("patch: %d %s", r.Status, r.Body)
	}
	if res := decode[testJSON](t, b.valid("POST", id+"/test", "")); !res.OK {
		t.Fatalf("the stored key must still work: %+v", res)
	}
	if r := b.valid("DELETE", id, ""); r.Status != 204 {
		t.Fatalf("delete: %d %s", r.Status, r.Body)
	}

	for _, path := range []string{"/plugin-instances", "/plugin-instances/" + itoa(first.ID), "/setup"} {
		if r := b.get(path); strings.Contains(r.Body, nzbKey) {
			t.Fatalf("GET %s leaks the API key: %s", path, r.Body)
		}
	}
	if s := b.valid("GET", "/setup", ""); !strings.Contains(s.Body, `"indexer":"done"`) {
		t.Fatalf("setup with an enabled indexer: %s", s.Body)
	}

	// Disabling the last enabled indexer sends the wizard section back to todo.
	b.valid("PATCH", "/plugin-instances/"+itoa(first.ID), `{"enabled":false}`)
	if s := b.valid("GET", "/setup", ""); !strings.Contains(s.Body, `"indexer":"todo"`) {
		t.Fatalf("setup with every indexer disabled: %s", s.Body)
	}
}

func TestNewznabConfigIsValidated(t *testing.T) {
	idx := fakeIndexer(t)
	b := newInstance(t, "", withSABAndNewznab(t)).setUp()
	r := b.valid("POST", "/plugin-instances", newznabBody("Bad", "not-a-url", nzbKey, ""))
	if r.Status != 422 || !strings.Contains(r.Body, `"field":"config.url"`) {
		t.Fatalf("bad url: %d %s", r.Status, r.Body)
	}
	r = b.valid("POST", "/plugin-instances", `{"plugin_id":"newznab","name":"x","config":{"url":"`+idx.URL+`"}}`)
	if r.Status != 422 || !strings.Contains(r.Body, `"field":"config.api_key"`) {
		t.Fatalf("missing key: %d %s", r.Status, r.Body)
	}
}
