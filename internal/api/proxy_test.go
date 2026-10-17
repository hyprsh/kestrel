package api_test

import (
	"strings"
	"testing"
)

// The test server is reached from 127.0.0.1, so trusting 127.0.0.1 makes the
// test client a trusted proxy and trusting 10.0.0.0/8 makes it an untrusted one.
func enableProxy(t *testing.T, b *browser, trusted string) {
	t.Helper()
	body := `{"enabled":true,"trusted_proxies":["` + trusted + `"],"header":"Remote-User"}`
	if r := b.do("PUT", "/settings/reverse-proxy", body); r.Status != 200 {
		t.Fatalf("PUT /settings/reverse-proxy = %d %s", r.Status, r.Body)
	}
}

func TestReverseProxyAuthIsOffByDefault(t *testing.T) {
	in := newInstance(t, "")
	b := in.setUp()

	if r := b.get("/settings/reverse-proxy"); r.Status != 200 ||
		!strings.Contains(r.Body, `"enabled":false`) || !strings.Contains(r.Body, `"header":"Remote-User"`) {
		t.Fatalf("defaults = %d %s", r.Status, r.Body)
	}
	if r := in.call("GET", "/auth/me", "", map[string]string{"Remote-User": "admin"}); r.Status != 401 {
		t.Errorf("Remote-User with the feature off = %d, want 401", r.Status)
	}
}

func TestATrustedProxyLogsTheAdminInPerRequestWithoutACookie(t *testing.T) {
	in := newInstance(t, "")
	enableProxy(t, in.setUp(), "127.0.0.1")

	r := in.call("GET", "/auth/me", "", map[string]string{"Remote-User": "alice@sso"})
	if r.Status != 200 || !strings.Contains(r.Body, `"method":"proxy"`) ||
		!strings.Contains(r.Body, `"proxy_user":"alice@sso"`) || !strings.Contains(r.Body, `"username":"admin"`) {
		t.Fatalf("me via proxy = %d %s", r.Status, r.Body)
	}
	if len(r.Cookie) != 0 {
		t.Errorf("proxy requests must not start a session: %v", r.Cookie)
	}
	if r := in.call("GET", "/auth/me", "", map[string]string{"Remote-User": ""}); r.Status != 401 {
		t.Errorf("an empty header = %d, want 401", r.Status)
	}
	if r := in.call("GET", "/auth/me", "", nil); r.Status != 401 {
		t.Errorf("no header = %d, want 401", r.Status)
	}
}

func TestATrustedCIDRRangeCountsToo(t *testing.T) {
	in := newInstance(t, "")
	enableProxy(t, in.setUp(), "127.0.0.0/8")
	if r := in.call("GET", "/auth/me", "", map[string]string{"Remote-User": "alice"}); r.Status != 200 {
		t.Errorf("me from inside the trusted range = %d, want 200", r.Status)
	}
}

func TestTheHeaderFromAnUntrustedAddressIsIgnoredAndRecorded(t *testing.T) {
	in := newInstance(t, "")
	b := in.setUp()
	enableProxy(t, b, "10.0.0.0/8")

	for i := 0; i < 2; i++ {
		if r := in.call("GET", "/auth/me", "", map[string]string{"Remote-User": "mallory"}); r.Status != 401 {
			t.Fatalf("forged header = %d %s, want 401", r.Status, r.Body)
		}
	}
	r := b.get("/settings/reverse-proxy")
	for _, want := range []string{`"ip":"127.0.0.1"`, `"value":"mallory"`, `"count":2`} {
		if !strings.Contains(r.Body, want) {
			t.Errorf("recorded sightings %s lack %s", r.Body, want)
		}
	}
}

func TestProxySettingsAreValidated(t *testing.T) {
	in := newInstance(t, "")
	b := in.setUp()
	for _, body := range []string{
		`{"enabled":true,"trusted_proxies":["not an ip"],"header":"Remote-User"}`,
		`{"enabled":true,"trusted_proxies":["10.0.0.0/33"],"header":"Remote-User"}`,
		`{"enabled":true,"trusted_proxies":[],"header":"Remote-User"}`,
		`{"enabled":false,"trusted_proxies":[],"header":"bad header"}`,
	} {
		if r := b.do("PUT", "/settings/reverse-proxy", body); r.Status != 422 {
			t.Errorf("PUT %s = %d %s, want 422", body, r.Status, r.Body)
		}
	}
}

func TestBehindATrustedProxyTheClientIsTheRightmostUntrustedForwardedAddress(t *testing.T) {
	in := newInstance(t, "")
	enableProxy(t, in.setUp(), "127.0.0.1")
	bad := map[string]string{"X-Api-Key": "kst_nope", "X-Forwarded-For": "203.0.113.9, 198.51.100.7, 127.0.0.1"}
	for i := 0; i < 5; i++ {
		in.call("GET", "/auth/me", "", bad)
	}
	if r := in.call("GET", "/auth/me", "", bad); r.Status != 429 {
		t.Fatalf("6th bad key = %d, want 429", r.Status)
	}
	// Another real client behind the same proxy is not throttled with it.
	other := map[string]string{"X-Api-Key": "kst_nope", "X-Forwarded-For": "192.0.2.1"}
	if r := in.call("GET", "/auth/me", "", other); r.Status != 401 {
		t.Errorf("a different client behind the proxy = %d, want 401", r.Status)
	}
}
