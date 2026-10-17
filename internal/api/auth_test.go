package api_test

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/api"
	"github.com/hyprsh/kestrel/internal/store"
)

// fakeClock is the instance's time, moved by tests.
type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func newClock() *fakeClock { return &fakeClock{now: time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)} }
func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}
func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

// instance is a running Kestrel on a temp-dir SQLite and a fake clock.
type instance struct {
	t     *testing.T
	srv   *httptest.Server
	st    *store.Store
	clock *fakeClock
	base  string
}

// newInstance starts Kestrel; each option adjusts api.Options first (e.g. Plugins).
func newInstance(t *testing.T, base string, with ...func(*api.Options)) *instance {
	t.Helper()
	st, err := store.Open(context.Background(), store.Options{Dir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	clock := newClock()
	opts := api.Options{Version: "1.2.3", BaseURL: base, Store: st, Web: webFS, Clock: clock.Now}
	for _, f := range with {
		f(&opts)
	}
	h := api.NewHandler(opts)
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return &instance{t: t, srv: srv, st: st, clock: clock, base: base}
}

// browser is one cookie-holding client, like a browser tab.
type browser struct {
	in      *instance
	cookies []*http.Cookie
	// Header overrides applied to every request.
	Origin      string
	ContentType string
}

func (in *instance) browser() *browser {
	return &browser{in: in, ContentType: "application/json"}
}

type reply struct {
	Status int
	Header http.Header
	Body   string
	Cookie []*http.Cookie
}

func (b *browser) do(method, path, body string) reply {
	b.in.t.Helper()
	req, err := http.NewRequest(method, b.in.srv.URL+b.in.base+"/api/v1"+path, strings.NewReader(body))
	if err != nil {
		b.in.t.Fatal(err)
	}
	if method != "GET" {
		req.Header.Set("Content-Type", b.ContentType)
		origin := b.Origin
		if origin == "" {
			origin = b.in.srv.URL
		}
		req.Header.Set("Origin", origin)
	}
	for _, c := range b.cookies {
		req.AddCookie(c)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		b.in.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	for _, c := range res.Cookies() {
		b.setCookie(c)
	}
	return reply{Status: res.StatusCode, Header: res.Header, Body: string(raw), Cookie: res.Cookies()}
}

func (b *browser) setCookie(c *http.Cookie) {
	kept := b.cookies[:0:0]
	for _, old := range b.cookies {
		if old.Name != c.Name {
			kept = append(kept, old)
		}
	}
	if c.MaxAge >= 0 && c.Value != "" {
		kept = append(kept, c)
	}
	b.cookies = kept
}

func (b *browser) get(path string) reply { return b.do("GET", path, "") }
func (b *browser) post(path, body string) reply {
	return b.do("POST", path, body)
}

const adminJSON = `{"username":"admin","password":"correct horse"}`

// setUp creates the admin account through the API and returns a logged-in browser.
func (in *instance) setUp() *browser {
	in.t.Helper()
	b := in.browser()
	if r := b.post("/setup/account", adminJSON); r.Status != 201 {
		in.t.Fatalf("setup/account = %d %s", r.Status, r.Body)
	}
	return b
}

func (in *instance) login() *browser {
	in.t.Helper()
	b := in.browser()
	if r := b.post("/auth/login", adminJSON); r.Status != 204 {
		in.t.Fatalf("login = %d %s", r.Status, r.Body)
	}
	return b
}

func TestFreshInstanceAnswersOnlySetupEndpoints(t *testing.T) {
	in := newInstance(t, "")
	b := in.browser()

	for _, path := range []string{"/setup", "/system"} {
		if r := b.get(path); r.Status != 200 {
			t.Errorf("GET %s on a fresh instance = %d, want 200", path, r.Status)
		}
	}
	if res, _ := get(t, in.srv.URL+"/ping"); res.StatusCode != 200 {
		t.Errorf("ping = %d", res.StatusCode)
	}
	for _, path := range []string{"/auth/me", "/does-not-exist"} {
		r := b.get(path)
		if r.Status != 401 || !strings.Contains(r.Body, `"code":"setup_required"`) {
			t.Errorf("GET %s on a fresh instance = %d %s, want 401 setup_required", path, r.Status, r.Body)
		}
	}
	if r := b.post("/auth/login", adminJSON); r.Status != 401 || !strings.Contains(r.Body, `"code":"setup_required"`) {
		t.Errorf("login on a fresh instance = %d %s", r.Status, r.Body)
	}
}

func TestSetupCreatesTheAccountAndLogsIn(t *testing.T) {
	in := newInstance(t, "")
	b := in.browser()

	r := b.post("/setup/account", adminJSON)
	if r.Status != 201 {
		t.Fatalf("setup/account = %d %s", r.Status, r.Body)
	}
	if me := b.get("/auth/me"); me.Status != 200 || !strings.Contains(me.Body, `"username":"admin"`) {
		t.Fatalf("me after setup = %d %s", me.Status, me.Body)
	}
	if s := b.get("/setup"); !strings.Contains(s.Body, `"account_exists":true`) {
		t.Errorf("setup = %s", s.Body)
	}

	// From now on the instance is never open without a login.
	anon := in.browser()
	for _, path := range []string{"/system", "/setup", "/auth/me"} {
		r := anon.get(path)
		if r.Status != 401 || !strings.Contains(r.Body, `"code":"unauthenticated"`) {
			t.Errorf("anonymous GET %s = %d %s, want 401 unauthenticated", path, r.Status, r.Body)
		}
	}
	if r := anon.post("/setup/account", `{"username":"mallory","password":"hunter2hunter2"}`); r.Status == 201 {
		t.Error("a second account was created")
	}
	if r := in.browser().post("/auth/login", `{"username":"mallory","password":"hunter2hunter2"}`); r.Status != 401 {
		t.Errorf("login as mallory = %d", r.Status)
	}
}

func TestSetupRejectsWeakCredentials(t *testing.T) {
	in := newInstance(t, "")
	b := in.browser()
	for _, body := range []string{`{"username":"admin","password":"short"}`, `{"username":" ","password":"long enough pw"}`} {
		r := b.post("/setup/account", body)
		if r.Status != 422 || !strings.Contains(r.Body, `"code":"validation"`) {
			t.Errorf("setup/account %s = %d %s, want 422 validation", body, r.Status, r.Body)
		}
	}
	if r := b.post("/setup/account", adminJSON); r.Status != 201 {
		t.Errorf("a valid account after rejections = %d %s", r.Status, r.Body)
	}
}
