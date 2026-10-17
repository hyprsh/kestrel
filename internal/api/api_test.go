package api_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers/legacy"

	kapi "github.com/hyprsh/kestrel/api"
	"github.com/hyprsh/kestrel/internal/api"
	"github.com/hyprsh/kestrel/internal/store"
)

const indexHTML = `<!doctype html><html><head><base href="/" /></head><body><div id="root"></div></body></html>`

var webFS = fstest.MapFS{
	"index.html":    {Data: []byte(indexHTML)},
	"assets/app.js": {Data: []byte("console.log('kestrel')")},
}

// startServer runs the real handler on a temp-dir SQLite.
func startServer(t *testing.T, base string, web fstest.MapFS) *httptest.Server {
	t.Helper()
	st, err := store.Open(context.Background(), store.Options{Dir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	h := api.NewHandler(api.Options{Version: "1.2.3", BaseURL: base, Store: st, Web: web})
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return srv
}

func get(t *testing.T, url string) (*http.Response, string) {
	t.Helper()
	res, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res, string(b)
}

// validateAgainstSpec checks a live response against openapi.yaml.
func validateAgainstSpec(t *testing.T, req *http.Request, res *http.Response, body string) {
	t.Helper()
	doc, err := openapi3.NewLoader().LoadFromData(kapi.Spec)
	if err != nil {
		t.Fatal(err)
	}
	doc.Servers = openapi3.Servers{{URL: "http://" + req.URL.Host + "/api/v1"}}
	router, err := legacy.NewRouter(doc)
	if err != nil {
		t.Fatal(err)
	}
	route, params, err := router.FindRoute(req)
	if err != nil {
		t.Fatalf("route not in spec: %v", err)
	}
	err = openapi3filter.ValidateResponse(context.Background(), &openapi3filter.ResponseValidationInput{
		RequestValidationInput: &openapi3filter.RequestValidationInput{Request: req, PathParams: params, Route: route},
		Status:                 res.StatusCode,
		Header:                 res.Header,
		Body:                   io.NopCloser(strings.NewReader(body)),
		Options:                &openapi3filter.Options{IncludeResponseStatus: true},
	})
	if err != nil {
		t.Fatalf("response violates openapi.yaml: %v\nbody: %s", err, body)
	}
}

func TestSystemIsServedFromTheSpecAndMatchesIt(t *testing.T) {
	srv := startServer(t, "", webFS)
	req, _ := http.NewRequest("GET", srv.URL+"/api/v1/system", nil)
	res, body := get(t, req.URL.String())

	if res.StatusCode != 200 {
		t.Fatalf("status %d: %s", res.StatusCode, body)
	}
	validateAgainstSpec(t, req, res, body)

	var sys struct {
		Version  string `json:"version"`
		APIMajor int    `json:"api_major"`
		BaseURL  string `json:"base_url"`
	}
	if err := json.Unmarshal([]byte(body), &sys); err != nil {
		t.Fatal(err)
	}
	if sys.Version != "1.2.3" || sys.APIMajor != 1 || sys.BaseURL != "" {
		t.Fatalf("system = %+v", sys)
	}
}

func TestPingIsUnauthenticatedWithNoBody(t *testing.T) {
	srv := startServer(t, "", webFS)
	res, body := get(t, srv.URL+"/ping")
	if res.StatusCode != 200 || body != "" {
		t.Fatalf("ping = %d %q", res.StatusCode, body)
	}
}

func TestBaseURLPrefixesEveryRoute(t *testing.T) {
	srv := startServer(t, "/kestrel", webFS)

	for _, path := range []string{"/kestrel/ping", "/kestrel/api/v1/system", "/kestrel/api/v1/openapi.json", "/kestrel/api/docs", "/kestrel/", "/kestrel/library"} {
		if res, _ := get(t, srv.URL+path); res.StatusCode != 200 {
			t.Errorf("GET %s = %d, want 200", path, res.StatusCode)
		}
	}
	for _, path := range []string{"/ping", "/api/v1/system", "/", "/library"} {
		if res, _ := get(t, srv.URL+path); res.StatusCode != 404 {
			t.Errorf("GET %s outside the prefix = %d, want 404", path, res.StatusCode)
		}
	}

	_, body := get(t, srv.URL+"/kestrel/api/v1/system")
	if !strings.Contains(body, `"base_url":"/kestrel"`) {
		t.Errorf("system should report the base url: %s", body)
	}

	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Get(srv.URL + "/kestrel")
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusMovedPermanently || res.Header.Get("Location") != "/kestrel/" {
		t.Errorf("GET /kestrel = %d -> %q, want redirect to /kestrel/", res.StatusCode, res.Header.Get("Location"))
	}
}

func TestSpecAndDocsArePublished(t *testing.T) {
	srv := startServer(t, "/kestrel", webFS)

	res, body := get(t, srv.URL+"/kestrel/api/v1/openapi.json")
	if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("content type %q", ct)
	}
	doc, err := openapi3.NewLoader().LoadFromData([]byte(body))
	if err != nil {
		t.Fatalf("served spec is not a valid OpenAPI document: %v", err)
	}
	if doc.Paths.Find("/system") == nil {
		t.Error("served spec lacks /system")
	}
	if len(doc.Servers) != 1 || doc.Servers[0].URL != "/kestrel/api/v1" {
		t.Errorf("servers = %v, want the prefixed API root", doc.Servers)
	}

	res, body = get(t, srv.URL+"/kestrel/api/docs")
	if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/html") || !strings.Contains(body, "openapi.json") {
		t.Errorf("docs page: %q %q", ct, body)
	}
}

func TestSPAIsServedWithAnIndexFallbackAndTheBaseHref(t *testing.T) {
	srv := startServer(t, "/kestrel", webFS)

	for _, path := range []string{"/kestrel/", "/kestrel/library", "/kestrel/title/42"} {
		res, body := get(t, srv.URL+path)
		if res.StatusCode != 200 || !strings.Contains(body, `<base href="/kestrel/" />`) {
			t.Errorf("GET %s = %d %q, want the index with the prefixed base href", path, res.StatusCode, body)
		}
	}
	if res, body := get(t, srv.URL+"/kestrel/assets/app.js"); res.StatusCode != 200 || !strings.Contains(body, "kestrel") {
		t.Errorf("asset = %d %q", res.StatusCode, body)
	}
	if res, _ := get(t, srv.URL+"/kestrel/assets/missing.js"); res.StatusCode != 404 {
		t.Errorf("missing asset = %d, want 404 rather than the index", res.StatusCode)
	}
}

func TestUnknownAPIPathsAreProblemJSONNotTheSPA(t *testing.T) {
	b := newInstance(t, "").setUp()
	r := b.get("/nope")
	if r.Status != 404 || r.Header.Get("Content-Type") != "application/problem+json" || !strings.Contains(r.Body, `"code":"not_found"`) {
		t.Fatalf("GET /api/v1/nope = %d %q %q", r.Status, r.Header.Get("Content-Type"), r.Body)
	}
}

func TestMissingSPABuildDoesNotBreakTheAPI(t *testing.T) {
	srv := startServer(t, "", fstest.MapFS{})
	if res, _ := get(t, srv.URL+"/"); res.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("GET / without a built SPA = %d, want 503", res.StatusCode)
	}
	if res, _ := get(t, srv.URL+"/api/v1/system"); res.StatusCode != 200 {
		t.Errorf("API = %d, want 200", res.StatusCode)
	}
}
