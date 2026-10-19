package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/app"
	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/adapters/sabnzbd"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
)

const sabKey = "0123456789abcdef0123456789abcdef"

// fakeSAB answers the few SABnzbd calls the plugin API makes: version, get_config.
func fakeSAB(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		switch {
		case q.Get("mode") == "version":
			_, _ = w.Write([]byte(`{"version": "4.5.1"}`))
		case q.Get("apikey") != sabKey:
			_, _ = w.Write([]byte(`{"status": false, "error": "API Key Incorrect"}`))
		case q.Get("mode") == "get_config":
			_, _ = w.Write([]byte(`{"config": {"categories": [{"name": "*"}, {"name": "movies"}, {"name": "tv"}]}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func withSAB(t *testing.T) func(*app.Options) {
	reg := plugin.NewRegistry()
	if err := reg.Register(downloadclient.Contract, sabnzbd.New(nil)); err != nil {
		t.Fatal(err)
	}
	return func(o *app.Options) { o.Plugins = reg }
}

// valid sends a request and checks the answer against openapi.yaml.
func (b *browser) valid(method, path, body string) reply {
	b.in.t.Helper()
	r := b.do(method, path, body)
	req, _ := http.NewRequest(method, b.in.srv.URL+b.in.base+"/api/v1"+path, nil)
	validateAgainstSpec(b.in.t, req, &http.Response{StatusCode: r.Status, Header: r.Header}, r.Body)
	return r
}

func decode[T any](t *testing.T, r reply) T {
	t.Helper()
	var v T
	if err := json.Unmarshal([]byte(r.Body), &v); err != nil {
		t.Fatalf("%v in %s", err, r.Body)
	}
	return v
}

type instanceJSON struct {
	ID         int64          `json:"id"`
	Contract   string         `json:"contract"`
	PluginID   string         `json:"plugin_id"`
	Name       string         `json:"name"`
	Enabled    bool           `json:"enabled"`
	Priority   int            `json:"priority"`
	Config     map[string]any `json:"config"`
	SecretsSet []string       `json:"secrets_set"`
	// FromConfigFile is true for an instance the Config File declares.
	FromConfigFile bool `json:"from_config_file"`
}

type testJSON struct {
	OK      bool    `json:"ok"`
	Code    *string `json:"code"`
	Message string  `json:"message"`
}

func sabBody(srvURL, key string, extra string) string {
	return `{"plugin_id":"sabnzbd","name":"SABnzbd","config":{"url":"` + srvURL + `","api_key":"` + key + `"` + extra + `}}`
}

func TestPluginEndpointsNeedALogin(t *testing.T) {
	in := newInstance(t, "", withSAB(t))
	b := in.setUp()
	anon := in.browser()
	for _, path := range []string{"/plugins", "/plugin-instances", "/plugin-instances/1"} {
		if r := anon.get(path); r.Status != 401 {
			t.Errorf("anonymous GET %s = %d", path, r.Status)
		}
	}
	if r := b.valid("GET", "/plugins", ""); r.Status != 200 {
		t.Fatalf("logged in: %d %s", r.Status, r.Body)
	}
}

func TestPluginsListManifestsDrawnFromTheAdapters(t *testing.T) {
	b := newInstance(t, "", withSAB(t)).setUp()
	r := b.valid("GET", "/plugins", "")
	var got struct {
		Items []struct {
			ID, Contract string
			Fields       []struct {
				Key, Type string
				Required  bool
				Default   any
				Live      bool
			}
		}
	}
	if err := json.Unmarshal([]byte(r.Body), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Items) != 1 || got.Items[0].ID != "sabnzbd" || got.Items[0].Contract != "download_client.v1" {
		t.Fatalf("%s", r.Body)
	}
	byKey := map[string]string{}
	for _, f := range got.Items[0].Fields {
		byKey[f.Key] = f.Type
	}
	if byKey["api_key"] != "secret" || byKey["url"] != "url" || byKey["movie_category"] != "text" || byKey["tv_category"] != "text" {
		t.Fatalf("fields %v", byKey)
	}
}

func TestConnectingSABnzbdEndToEnd(t *testing.T) {
	sab := fakeSAB(t)
	in := newInstance(t, "", withSAB(t))
	b := in.setUp()

	// The wizard tests the unsaved form: a bad key shows the error...
	r := b.valid("POST", "/plugin-instances/test", `{"plugin_id":"sabnzbd","config":{"url":"`+sab.URL+`","api_key":"wrong"}}`)
	if res := decode[testJSON](t, r); r.Status != 200 || res.OK || res.Code == nil || *res.Code != "auth" {
		t.Fatalf("bad key: %d %s", r.Status, r.Body)
	}
	// ...and a good one the live result, then the category list.
	r = b.valid("POST", "/plugin-instances/test", `{"plugin_id":"sabnzbd","config":{"url":"`+sab.URL+`","api_key":"`+sabKey+`"}}`)
	if res := decode[testJSON](t, r); !res.OK || res.Code != nil || res.Message != "SABnzbd 4.5.1" {
		t.Fatalf("good key: %s", r.Body)
	}
	r = b.valid("POST", "/plugins/sabnzbd/options/movie_category", `{"config":{"url":"`+sab.URL+`","api_key":"`+sabKey+`"}}`)
	if r.Status != 200 || !strings.Contains(r.Body, `{"label":"movies","value":"movies"}`) || !strings.Contains(r.Body, `"tv"`) {
		t.Fatalf("options: %d %s", r.Status, r.Body)
	}

	// Saving fills the category defaults and never echoes the key.
	r = b.valid("POST", "/plugin-instances", sabBody(sab.URL, sabKey, ""))
	if r.Status != 201 {
		t.Fatalf("create: %d %s", r.Status, r.Body)
	}
	created := decode[instanceJSON](t, r)
	if created.Contract != "download_client.v1" || !created.Enabled || created.Config["movie_category"] != "movies" || created.Config["tv_category"] != "tv" {
		t.Fatalf("%+v", created)
	}
	if _, has := created.Config["api_key"]; has || len(created.SecretsSet) != 1 || created.SecretsSet[0] != "api_key" {
		t.Fatalf("the key must be reported only as set: %+v", created)
	}

	// The saved instance tests with its stored key; edits are merged over it.
	id := "/plugin-instances/" + itoa(created.ID)
	if res := decode[testJSON](t, b.valid("POST", id+"/test", "")); !res.OK {
		t.Fatalf("saved test failed: %+v", res)
	}
	r = b.valid("POST", id+"/test", `{"config":{"api_key":"edited-wrong"}}`)
	if res := decode[testJSON](t, r); res.OK || *res.Code != "auth" {
		t.Fatalf("edited test: %s", r.Body)
	}
	r = b.valid("POST", "/plugins/sabnzbd/options/tv_category", `{"config":{},"instance_id":`+itoa(created.ID)+`}`)
	if r.Status != 200 || !strings.Contains(r.Body, `"movies"`) {
		t.Fatalf("options with the stored key: %d %s", r.Status, r.Body)
	}

	// The key appears in no response, whichever way the instance is read.
	for _, path := range []string{"/plugin-instances", id, "/setup"} {
		if r := b.get(path); strings.Contains(r.Body, sabKey) {
			t.Fatalf("GET %s leaks the API key: %s", path, r.Body)
		}
	}
	if s := b.valid("GET", "/setup", ""); !strings.Contains(s.Body, `"download_client":"done"`) {
		t.Fatalf("setup should show the download client done: %s", s.Body)
	}
}

func TestSecretsAreKeptReplacedAndCleared(t *testing.T) {
	sab := fakeSAB(t)
	b := newInstance(t, "", withSAB(t)).setUp()
	created := decode[instanceJSON](t, b.valid("POST", "/plugin-instances", sabBody(sab.URL, sabKey, "")))
	id := "/plugin-instances/" + itoa(created.ID)

	r := b.valid("PATCH", id, `{"name":"Renamed","config":{"movie_category":"films"}}`)
	got := decode[instanceJSON](t, r)
	if r.Status != 200 || got.Name != "Renamed" || got.Config["movie_category"] != "films" || len(got.SecretsSet) != 1 {
		t.Fatalf("omitting the key keeps it: %d %s", r.Status, r.Body)
	}
	if !decode[testJSON](t, b.valid("POST", id+"/test", "")).OK {
		t.Fatal("the stored key must still work")
	}

	r = b.valid("PATCH", id, `{"config":{"api_key":null}}`)
	if r.Status != 422 || !strings.Contains(r.Body, `"field":"config.api_key"`) || !strings.Contains(r.Body, `"code":"validation"`) {
		t.Fatalf("clearing a required secret: %d %s", r.Status, r.Body)
	}
	r = b.valid("PATCH", id, `{"config":{"api_key":"another"}}`)
	if r.Status != 200 || strings.Contains(r.Body, "another") {
		t.Fatalf("replacing the key must not echo it: %d %s", r.Status, r.Body)
	}
	if res := decode[testJSON](t, b.valid("POST", id+"/test", "")); res.OK {
		t.Fatal("the replaced key is wrong for the fake SABnzbd, so the test must fail")
	}
}

func TestOnlyOneDownloadClientCanBeEnabled(t *testing.T) {
	sab := fakeSAB(t)
	b := newInstance(t, "", withSAB(t)).setUp()
	if r := b.valid("POST", "/plugin-instances", sabBody(sab.URL, sabKey, "")); r.Status != 201 {
		t.Fatal(r.Body)
	}
	r := b.valid("POST", "/plugin-instances", sabBody(sab.URL, sabKey, ""))
	if r.Status != 422 || !strings.Contains(r.Body, `"code":"validation"`) || !strings.Contains(r.Body, `"field":"enabled"`) {
		t.Fatalf("second enabled instance: %d %s", r.Status, r.Body)
	}
	disabled := strings.Replace(sabBody(sab.URL, sabKey, ""), `"name"`, `"enabled":false,"name"`, 1)
	r = b.valid("POST", "/plugin-instances", disabled)
	if r.Status != 201 {
		t.Fatalf("a disabled second instance: %d %s", r.Status, r.Body)
	}
	second := decode[instanceJSON](t, r)
	r = b.valid("PATCH", "/plugin-instances/"+itoa(second.ID), `{"enabled":true}`)
	if r.Status != 422 || !strings.Contains(r.Body, `"field":"enabled"`) {
		t.Fatalf("enabling a second instance: %d %s", r.Status, r.Body)
	}
}

func TestPluginInstanceValidationAndNotFound(t *testing.T) {
	sab := fakeSAB(t)
	b := newInstance(t, "", withSAB(t)).setUp()
	cases := []struct {
		name, method, path, body string
		status                   int
		contains                 string
	}{
		{"unknown plugin", "POST", "/plugin-instances", `{"plugin_id":"nope","name":"x","config":{}}`, 422, `"field":"plugin_id"`},
		{"missing key", "POST", "/plugin-instances", `{"plugin_id":"sabnzbd","name":"x","config":{"url":"` + sab.URL + `"}}`, 422, `"field":"config.api_key"`},
		{"bad url", "POST", "/plugin-instances", `{"plugin_id":"sabnzbd","name":"x","config":{"url":"sab:8080","api_key":"k"}}`, 422, `"field":"config.url"`},
		{"unknown setting", "POST", "/plugin-instances", sabBody(sab.URL, "k", `,"nope":1`), 422, `"field":"config.nope"`},
		{"unsaved test needs a complete form", "POST", "/plugin-instances/test", `{"plugin_id":"sabnzbd","config":{}}`, 422, `"field":"config.url"`},
		{"unknown instance", "GET", "/plugin-instances/99", "", 404, `"code":"not_found"`},
		{"patch unknown", "PATCH", "/plugin-instances/99", `{"name":"x"}`, 404, `"code":"not_found"`},
		{"delete unknown", "DELETE", "/plugin-instances/99", "", 404, `"code":"not_found"`},
		{"test unknown", "POST", "/plugin-instances/99/test", "", 404, `"code":"not_found"`},
		{"options for a field with none", "POST", "/plugins/sabnzbd/options/url", `{"config":{"url":"` + sab.URL + `","api_key":"` + sabKey + `"}}`, 422, `"field":"field"`},
		{"options for an unknown plugin", "POST", "/plugins/nope/options/x", `{"config":{}}`, 422, `"field":"plugin_id"`},
		{"options with a wrong key are an upstream problem", "POST", "/plugins/sabnzbd/options/tv_category", `{"config":{"url":"` + sab.URL + `","api_key":"wrong"}}`, 502, `"code":"upstream_unavailable"`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := b.valid(c.method, c.path, c.body)
			if r.Status != c.status || !strings.Contains(r.Body, c.contains) {
				t.Fatalf("%s %s = %d %s", c.method, c.path, r.Status, r.Body)
			}
		})
	}
}

func TestDeleteRemovesTheInstance(t *testing.T) {
	sab := fakeSAB(t)
	b := newInstance(t, "", withSAB(t)).setUp()
	created := decode[instanceJSON](t, b.valid("POST", "/plugin-instances", sabBody(sab.URL, sabKey, "")))
	id := "/plugin-instances/" + itoa(created.ID)
	if r := b.valid("DELETE", id, ""); r.Status != 204 {
		t.Fatalf("%d %s", r.Status, r.Body)
	}
	if r := b.valid("GET", id, ""); r.Status != 404 {
		t.Fatalf("%d", r.Status)
	}
	list := decode[struct{ Items []instanceJSON }](t, b.valid("GET", "/plugin-instances", ""))
	if len(list.Items) != 0 {
		t.Fatalf("%+v", list)
	}
	if s := b.valid("GET", "/setup", ""); !strings.Contains(s.Body, `"download_client":"todo"`) {
		t.Fatal(s.Body)
	}
}

func itoa(n int64) string { return strings.TrimSpace(strings.Join(strings.Fields(jsonInt(n)), "")) }

func jsonInt(n int64) string { b, _ := json.Marshal(n); return string(b) }
