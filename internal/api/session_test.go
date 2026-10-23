package api_test

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/api"
)

func TestLoginSetsAnHttpOnlyLaxCookieScopedToTheBaseURL(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "/kestrel")
	in.setUp()
	b := in.browser()

	r := b.post("/auth/login", adminJSON)
	if r.Status != 204 || len(r.Cookie) != 1 {
		t.Fatalf("login = %d %v", r.Status, r.Cookie)
	}
	c := r.Cookie[0]
	if !c.HttpOnly || c.SameSite != http.SameSiteLaxMode || c.Path != "/kestrel" || c.Secure {
		t.Errorf("cookie = %+v, want HttpOnly, SameSite=Lax, Path=/kestrel and no Secure over plain HTTP", c)
	}
	if me := b.get("/auth/me"); me.Status != 200 {
		t.Errorf("me after login = %d", me.Status)
	}
}

func TestCookieIsSecureBehindATLSTerminatingProxy(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	trustForAddresses(t, in.setUp(), "127.0.0.1")
	req, _ := http.NewRequest("POST", in.srv.URL+"/api/v1/auth/login", strings.NewReader(adminJSON))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Forwarded-Proto", "https")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if cs := res.Cookies(); len(cs) != 1 || !cs[0].Secure || cs[0].Path != "/" {
		t.Errorf("cookies = %v, want one Secure cookie on Path=/", cs)
	}
}

func TestWrongCredentialsAreRefusedWithoutSayingWhich(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	in.setUp()
	for _, body := range []string{
		`{"username":"admin","password":"wrong password"}`,
		`{"username":"nobody","password":"correct horse"}`,
	} {
		r := in.browser().post("/auth/login", body)
		if r.Status != 401 || !strings.Contains(r.Body, `"code":"unauthenticated"`) || len(r.Cookie) != 0 {
			t.Errorf("login %s = %d %s", body, r.Status, r.Body)
		}
	}
}

func TestActivitySlidesTheThirtyDayExpiry(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	in.setUp()
	b := in.login()

	in.clock.Advance(20 * 24 * time.Hour)
	if r := b.get("/auth/me"); r.Status != 200 {
		t.Fatalf("day 20 = %d", r.Status)
	}
	in.clock.Advance(20 * 24 * time.Hour) // day 40: past 30 days from login, within 30 of the last activity
	if r := b.get("/auth/me"); r.Status != 200 {
		t.Fatalf("day 40 after activity on day 20 = %d, want the session slid", r.Status)
	}
	in.clock.Advance(31 * 24 * time.Hour)
	if r := b.get("/auth/me"); r.Status != 401 {
		t.Fatalf("after 31 idle days = %d, want 401", r.Status)
	}
}

func TestLogOutEndsTheSessionAndClearsTheCookie(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	in.setUp()
	b := in.login()
	other := in.login()
	saved := append([]*http.Cookie(nil), b.cookies...)

	r := b.post("/auth/logout", "")
	if r.Status != 204 || len(r.Cookie) != 1 || r.Cookie[0].MaxAge >= 0 {
		t.Fatalf("logout = %d %v, want 204 and a clearing cookie", r.Status, r.Cookie)
	}
	replay := in.browser()
	replay.cookies = saved
	if r := replay.get("/auth/me"); r.Status != 401 {
		t.Errorf("the logged-out cookie replayed = %d, want 401", r.Status)
	}
	if r := other.get("/auth/me"); r.Status != 200 {
		t.Errorf("another session = %d, want it untouched", r.Status)
	}
}

func TestLogOutEverywhereEndsEverySession(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	a := in.setUp()
	b := in.login()
	savedA := append([]*http.Cookie(nil), a.cookies...)

	if r := a.post("/auth/logout-everywhere", ""); r.Status != 204 {
		t.Fatalf("logout-everywhere = %d", r.Status)
	}
	replay := in.browser()
	replay.cookies = savedA
	if r := replay.get("/auth/me"); r.Status != 401 {
		t.Errorf("the calling session afterwards = %d, want 401", r.Status)
	}
	if r := b.get("/auth/me"); r.Status != 401 {
		t.Errorf("the other session afterwards = %d, want 401", r.Status)
	}
}

func TestChangingThePasswordLogsOutOtherSessions(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	in.setUp()
	here := in.login()
	elsewhere := in.login()

	r := here.post("/account/password", `{"current_password":"wrong wrong","new_password":"brand new pass"}`)
	if r.Status != 422 || !strings.Contains(r.Body, `"field":"current_password"`) {
		t.Fatalf("wrong current password = %d %s", r.Status, r.Body)
	}
	if r := here.post("/account/password", `{"current_password":"correct horse","new_password":"short"}`); r.Status != 422 {
		t.Fatalf("short new password = %d", r.Status)
	}
	if elsewhere.get("/auth/me").Status != 200 {
		t.Fatal("a rejected change must not end sessions")
	}

	if r := here.post("/account/password", `{"current_password":"correct horse","new_password":"brand new pass"}`); r.Status != 204 {
		t.Fatalf("change = %d %s", r.Status, r.Body)
	}
	if r := here.get("/auth/me"); r.Status != 200 {
		t.Errorf("the changing session = %d, want it kept", r.Status)
	}
	if r := elsewhere.get("/auth/me"); r.Status != 401 {
		t.Errorf("the other session = %d, want it ended", r.Status)
	}
	if r := in.browser().post("/auth/login", adminJSON); r.Status != 401 {
		t.Errorf("old password still works: %d", r.Status)
	}
	if r := in.browser().post("/auth/login", `{"username":"admin","password":"brand new pass"}`); r.Status != 204 {
		t.Errorf("new password = %d", r.Status)
	}
}

func TestFiveFailedLoginsSlowFurtherAttempts(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	in.setUp()
	b := in.browser()
	bad := `{"username":"admin","password":"wrong password"}`

	for i := 1; i <= 5; i++ {
		if r := b.post("/auth/login", bad); r.Status != 401 {
			t.Fatalf("failure %d = %d", i, r.Status)
		}
	}
	r := b.post("/auth/login", adminJSON)
	if r.Status != 429 || !strings.Contains(r.Body, `"code":"rate_limited"`) || r.Header.Get("Retry-After") == "" {
		t.Fatalf("attempt after five failures = %d %v %s, want 429 with Retry-After", r.Status, r.Header, r.Body)
	}
	if len(r.Cookie) != 0 {
		t.Error("a throttled attempt must not log in, even with the right password")
	}

	// Waiting lets the right password through, and success resets the count.
	in.clock.Advance(time.Minute)
	if r := b.post("/auth/login", adminJSON); r.Status != 204 {
		t.Fatalf("after waiting = %d", r.Status)
	}
	if r := b.post("/auth/login", bad); r.Status != 401 {
		t.Fatalf("a failure after success = %d, want a plain 401 (count reset)", r.Status)
	}
}

func TestLoginBackoffGrowsButNeverPastFifteenMinutes(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	in.setUp()
	b := in.browser()
	bad := `{"username":"admin","password":"wrong password"}`

	var first, longest int
	for i := 0; i < 40; i++ {
		r := b.post("/auth/login", bad)
		for r.Status == 429 { // honour the wait, then fail again
			secs, _ := strconv.Atoi(r.Header.Get("Retry-After"))
			if first == 0 {
				first = secs
			}
			longest = max(longest, secs)
			in.clock.Advance(time.Duration(secs) * time.Second)
			r = b.post("/auth/login", bad)
		}
	}
	if first == 0 || longest <= first {
		t.Errorf("first wait %d s, longest %d s: the backoff should grow", first, longest)
	}
	if longest > 15*60 {
		t.Errorf("longest wait %d s exceeds the 15 minute cap", longest)
	}
}

func TestForeignOriginAndNonJSONStateChangesAreRefused(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	b := in.setUp()

	b.Origin = "https://evil.example"
	r := b.post("/auth/logout-everywhere", "")
	if r.Status != 403 || !strings.Contains(r.Body, `"code":"forbidden_origin"`) {
		t.Errorf("foreign origin = %d %s", r.Status, r.Body)
	}
	b.Origin = "null"
	if r := b.post("/auth/logout-everywhere", ""); r.Status != 403 {
		t.Errorf("null origin = %d", r.Status)
	}

	b.Origin = ""
	b.ContentType = "text/plain"
	if r := b.post("/auth/logout-everywhere", ""); r.Status != 403 {
		t.Errorf("text/plain = %d", r.Status)
	}
	b.ContentType = "application/x-www-form-urlencoded"
	if r := b.post("/auth/login", "username=admin&password=correct+horse"); r.Status != 403 {
		t.Errorf("form post = %d", r.Status)
	}

	// None of the refused requests had any effect.
	b.ContentType = "application/json"
	if r := b.get("/auth/me"); r.Status != 200 {
		t.Errorf("session after refused requests = %d", r.Status)
	}
}

func TestOriginIsComparedByHostAndPortIgnoringTheScheme(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	b := in.setUp()
	host := strings.TrimPrefix(in.srv.URL, "http://")

	b.Origin = "https://" + host // behind a TLS-terminating proxy the scheme differs, the host does not
	if r := b.post("/auth/logout-everywhere", ""); r.Status != 204 {
		t.Errorf("scheme mismatch only = %d, want it accepted", r.Status)
	}
}

func TestExpiredSessionsArePruned(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	in.setUp()
	in.clock.Advance(20 * 24 * time.Hour)
	in.login() // a younger session

	in.clock.Advance(15 * 24 * time.Hour) // the first is 35 days old, the second 15
	n, err := api.PruneSessions(context.Background(), in.st, in.clock.Now())
	if err != nil || n != 1 {
		t.Fatalf("pruned %d, %v, want exactly the expired one", n, err)
	}
}

func TestAuthResponsesMatchTheSpec(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	b := in.browser()
	check := func(method, path string, r reply) {
		t.Helper()
		req, _ := http.NewRequest(method, in.srv.URL+"/api/v1"+path, nil)
		validateAgainstSpec(t, req, &http.Response{StatusCode: r.Status, Header: r.Header}, r.Body)
	}
	check("GET", "/setup", b.get("/setup"))
	check("POST", "/setup/account", b.post("/setup/account", adminJSON))
	check("POST", "/setup/account", b.post("/setup/account", adminJSON)) // 409
	check("GET", "/auth/me", b.get("/auth/me"))
	check("GET", "/setup", b.get("/setup"))
	check("POST", "/account/password", b.post("/account/password", `{"current_password":"x","new_password":"yyyyyyyyy"}`))
	anon := in.browser()
	check("GET", "/auth/me", anon.get("/auth/me"))
	check("POST", "/auth/login", anon.post("/auth/login", `{"username":"admin","password":"nope nope"}`))
}
