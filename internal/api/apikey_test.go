package api_test

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

// call sends one request with no cookies and the given extra headers, like a
// script, a proxy-fronted browser or the Silo plugin.
func (in *instance) call(method, path, body string, headers map[string]string) reply {
	in.t.Helper()
	req, err := http.NewRequest(method, in.srv.URL+in.base+"/api/v1"+path, strings.NewReader(body))
	if err != nil {
		in.t.Fatal(err)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		in.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return reply{Status: res.StatusCode, Header: res.Header, Body: string(raw), Cookie: res.Cookies()}
}

// newKey generates (or rotates) the API key through the API and returns it.
func newKey(t *testing.T, b *browser) string {
	t.Helper()
	r := b.post("/api-key", "")
	if r.Status != 201 {
		t.Fatalf("POST /api-key = %d %s", r.Status, r.Body)
	}
	var out struct {
		Key string `json:"key"`
	}
	if err := json.Unmarshal([]byte(r.Body), &out); err != nil || !strings.HasPrefix(out.Key, "kst_") {
		t.Fatalf("key body = %s", r.Body)
	}
	return out.Key
}

func TestApiKeyIsGeneratedShownOnceAndOnlyItsPrefixIsKept(t *testing.T) {
	in := newInstance(t, "")
	b := in.setUp()

	if r := b.get("/api-key"); r.Status != 200 || !strings.Contains(r.Body, `"prefix":null`) {
		t.Fatalf("GET /api-key before generating = %d %s", r.Status, r.Body)
	}
	key := newKey(t, b)

	r := b.get("/api-key")
	if r.Status != 200 || !strings.Contains(r.Body, `"prefix":"`+key[:8]+`"`) || strings.Contains(r.Body, key) {
		t.Fatalf("GET /api-key = %d %s, want the prefix and never the key", r.Status, r.Body)
	}
	if !strings.Contains(r.Body, `"created_at":"2026-10-17T12:00:00Z"`) {
		t.Errorf("created_at missing: %s", r.Body)
	}
}

func TestApiKeyAuthenticatesWithoutASessionOrCSRFHeaders(t *testing.T) {
	in := newInstance(t, "")
	key := newKey(t, in.setUp())

	r := in.call("GET", "/auth/me", "", map[string]string{"X-Api-Key": key})
	if r.Status != 200 || !strings.Contains(r.Body, `"method":"api_key"`) {
		t.Fatalf("me with key = %d %s", r.Status, r.Body)
	}
	if len(r.Cookie) != 0 {
		t.Errorf("an API-key request must not start a session: %v", r.Cookie)
	}
	// Mutations need no JSON content type or Origin when the key is present.
	r = in.call("POST", "/account/password", `{"current_password":"correct horse","new_password":"battery staple"}`,
		map[string]string{"X-Api-Key": key})
	if r.Status != 204 {
		t.Errorf("POST with key and no Content-Type = %d %s", r.Status, r.Body)
	}
	// The key is accepted in the header only.
	if r := in.call("GET", "/auth/me?api_key="+key, "", nil); r.Status != 401 {
		t.Errorf("key in the query string = %d, want 401", r.Status)
	}
	if r := in.call("GET", "/auth/me", "", map[string]string{"Authorization": "Bearer " + key}); r.Status != 401 {
		t.Errorf("key as Bearer = %d, want 401", r.Status)
	}
}

func TestRotatingTheKeyStopsTheOldOneAtOnce(t *testing.T) {
	in := newInstance(t, "")
	b := in.setUp()
	old := newKey(t, b)
	fresh := newKey(t, b)

	if r := in.call("GET", "/auth/me", "", map[string]string{"X-Api-Key": old}); r.Status != 401 {
		t.Errorf("old key = %d, want 401", r.Status)
	}
	if r := in.call("GET", "/auth/me", "", map[string]string{"X-Api-Key": fresh}); r.Status != 200 {
		t.Errorf("new key = %d, want 200", r.Status)
	}
}

func TestTheKeyDecidesWhenCookieAndKeyBothArrive(t *testing.T) {
	in := newInstance(t, "")
	b := in.setUp()
	req, _ := http.NewRequest("GET", in.srv.URL+"/api/v1/auth/me", nil)
	req.Header.Set("X-Api-Key", "kst_wrong")
	for _, c := range b.cookies {
		req.AddCookie(c)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 401 {
		t.Errorf("valid cookie + bad key = %d, want 401", res.StatusCode)
	}
}

func TestBadKeysAreThrottledLikeFailedLogins(t *testing.T) {
	in := newInstance(t, "")
	key := newKey(t, in.setUp())
	bad := map[string]string{"X-Api-Key": "kst_nope"}

	for i := 0; i < 5; i++ {
		if r := in.call("GET", "/auth/me", "", bad); r.Status != 401 {
			t.Fatalf("bad key #%d = %d", i+1, r.Status)
		}
	}
	r := in.call("GET", "/auth/me", "", bad)
	if r.Status != 429 || !strings.Contains(r.Body, `"code":"rate_limited"`) || r.Header.Get("Retry-After") == "" {
		t.Fatalf("6th bad key = %d %s, want 429 rate_limited", r.Status, r.Body)
	}
	// While throttled even the right key waits; afterwards it works and resets.
	if r := in.call("GET", "/auth/me", "", map[string]string{"X-Api-Key": key}); r.Status != 429 {
		t.Errorf("good key while throttled = %d, want 429", r.Status)
	}
	in.clock.Advance(time.Minute)
	if r := in.call("GET", "/auth/me", "", map[string]string{"X-Api-Key": key}); r.Status != 200 {
		t.Errorf("good key after the wait = %d, want 200", r.Status)
	}
}

func TestAKeyIsRefusedWhenNoneWasGenerated(t *testing.T) {
	in := newInstance(t, "")
	in.setUp()
	if r := in.call("GET", "/auth/me", "", map[string]string{"X-Api-Key": "kst_"}); r.Status != 401 {
		t.Errorf("made-up key = %d, want 401", r.Status)
	}
}
