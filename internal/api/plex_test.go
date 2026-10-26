package api_test

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/app"
	"github.com/hyprsh/kestrel/internal/plextv"
	"github.com/hyprsh/kestrel/internal/plextv/plextvtest"
	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/adapters/plex"
	mediaserver "github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1"
)

// The household's Plex: anna and ben are friends with a share of this server,
// kim is a Plex Home user, stranger is nobody's friend.
var (
	anna     = plextv.Account{ID: 10, UUID: "u-anna", Username: "anna", Title: "Anna Smith"}
	ben      = plextv.Account{ID: 11, UUID: "u-ben", Username: "ben", Title: "Ben"}
	kim      = plextv.Account{ID: 12, UUID: "u-kim", Title: "Kim"} // a Home user has no username
	stranger = plextv.Account{ID: 99, UUID: "u-x", Username: "stranger", Title: "Stranger"}
)

// plexHousehold is a Kestrel with Plex sign-in on, a fake plex.tv and Plex, and the admin's browser.
type plexHousehold struct {
	*instance
	tv    *plextvtest.Server
	admin *browser
}

func withPlex(t *testing.T, tv *plextvtest.Server) func(*app.Options) {
	t.Helper()
	return func(o *app.Options) {
		if o.Plugins == nil {
			o.Plugins = plugin.NewRegistry()
		}
		if err := o.Plugins.Register(mediaserver.Contract, plex.New(nil)); err != nil {
			t.Fatal(err)
		}
		o.PlexTVURL, o.PlexAppURL = tv.URL, tv.URL+"/auth"
	}
}

// newHousehold starts Kestrel with the household's Plex and Plex sign-in on for everyone with access.
func newHousehold(t *testing.T, base string, with ...func(*app.Options)) *plexHousehold {
	t.Helper()
	tv := plextvtest.New(t)
	in := newInstance(t, base, append([]func(*app.Options){withPlex(t, tv)}, with...)...)
	return household(t, in, tv)
}

func household(t *testing.T, in *instance, tv *plextvtest.Server) *plexHousehold {
	t.Helper()
	return householdOf(t, in, tv, in.setUp())
}

// householdOf is household for an instance whose admin account exists already.
func householdOf(t *testing.T, in *instance, tv *plextvtest.Server, admin *browser) *plexHousehold {
	t.Helper()
	h := &plexHousehold{instance: in, tv: tv, admin: admin}
	for token, a := range map[string]plextv.Account{"anna-token": anna, "ben-token": ben, "kim-token": kim, "stranger-token": stranger} {
		tv.AddAccount(token, a)
	}
	tv.Share(plextv.SharedUser{ID: anna.ID, Username: anna.Username, Title: anna.Title, Servers: []string{plextvtest.Machine}})
	tv.Share(plextv.SharedUser{ID: ben.ID, Username: ben.Username, Title: ben.Title, Servers: []string{plextvtest.Machine}})
	tv.Share(plextv.SharedUser{ID: kim.ID, Title: kim.Title, Home: true})
	h.addPlex("Plex")
	h.putSignIn(`{"enabled":true,"instance":"Plex","users":[],"user_root_folders":[]}`)
	return h
}

func (h *plexHousehold) addPlex(name string) {
	h.t.Helper()
	body := `{"plugin_id":"plex","name":"` + name + `","config":{"url":"` + h.tv.URL + `","token":"` + plextvtest.OwnerToken + `"}}`
	if r := h.sendBody(h.admin, "POST", "/plugin-instances", body); r.Status != 201 {
		h.t.Fatalf("plex instance = %d %s", r.Status, r.Body)
	}
}

func (h *plexHousehold) putSignIn(body string) {
	h.t.Helper()
	if r := h.sendBody(h.admin, "PUT", "/settings/plex-sign-in", body); r.Status != 200 {
		h.t.Fatalf("PUT /settings/plex-sign-in = %d %s", r.Status, r.Body)
	}
}

// start is the first half of a Requester's sign-in: the Plex PIN, with its code.
func (h *plexHousehold) start(b *browser) (code string, r reply) {
	h.t.Helper()
	r = h.send(b, "POST", "/auth/plex/pin")
	if r.Status != 200 {
		return "", r
	}
	pin := decode[struct {
		AuthURL string `json:"auth_url"`
	}](h.t, r)
	_, frag, _ := strings.Cut(pin.AuthURL, "#?")
	q, err := url.ParseQuery(frag)
	if err != nil {
		h.t.Fatal(err)
	}
	return q.Get("code"), r
}

// signIn is a whole sign-in: the PIN, the account authorising it at Plex, the login.
func (h *plexHousehold) signIn(b *browser, token string) reply {
	h.t.Helper()
	code, r := h.start(b)
	if r.Status != 200 {
		return r
	}
	h.tv.Authorise(code, token)
	return h.send(b, "POST", "/auth/plex/login")
}

// send is a call checked against the spec, which names no base URL.
func (h *plexHousehold) send(b *browser, method, path string) reply {
	return h.sendBody(b, method, path, "")
}

func (h *plexHousehold) sendBody(b *browser, method, path, body string) reply {
	h.t.Helper()
	if h.base != "" {
		return b.do(method, path, body)
	}
	return b.valid(method, path, body)
}

// requester is a browser signed in as the account behind token.
func (h *plexHousehold) requester(token string) *browser {
	h.t.Helper()
	b := h.browser()
	if r := h.signIn(b, token); r.Status != 204 {
		h.t.Fatalf("sign-in with %s = %d %s", token, r.Status, r.Body)
	}
	return b
}

func TestPlexSignInIsOffUntilSwitchedOn(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	b := in.setUp()
	anon := in.browser()

	if r := anon.valid("GET", "/auth/plex", ""); r.Status != 200 || !strings.Contains(r.Body, `"enabled":false`) {
		t.Errorf("availability = %d %s, want it off", r.Status, r.Body)
	}
	if r := anon.valid("POST", "/auth/plex/pin", ""); r.Status != 403 || !strings.Contains(r.Body, `"code":"plex_sign_in_off"`) {
		t.Errorf("PIN while off = %d %s", r.Status, r.Body)
	}
	if r := anon.valid("POST", "/auth/plex/login", ""); r.Status != 403 || !strings.Contains(r.Body, `"code":"plex_sign_in_off"`) {
		t.Errorf("login while off = %d %s", r.Status, r.Body)
	}
	if r := b.valid("GET", "/settings/plex-sign-in", ""); r.Status != 200 || !strings.Contains(r.Body, `"enabled":false`) || !strings.Contains(r.Body, `"from_config_file":false`) {
		t.Errorf("settings = %d %s", r.Status, r.Body)
	}
}

func TestPlexAvailabilityFollowsTheSettingsWithoutALogin(t *testing.T) {
	t.Parallel()
	h := newHousehold(t, "")
	anon := h.browser()
	if r := anon.valid("GET", "/auth/plex", ""); !strings.Contains(r.Body, `"enabled":true`) {
		t.Errorf("availability = %s, want it on", r.Body)
	}
	h.putSignIn(`{"enabled":false,"instance":"Plex","users":[],"user_root_folders":[]}`)
	if r := anon.valid("GET", "/auth/plex", ""); !strings.Contains(r.Body, `"enabled":false`) {
		t.Errorf("availability = %s, want it off", r.Body)
	}
}

func TestARequesterSignsInWithPlexThroughAPin(t *testing.T) {
	t.Parallel()
	h := newHousehold(t, "/kestrel")
	b := h.browser()

	code, r := h.start(b)
	if len(r.Cookie) != 1 || r.Cookie[0].Name != "kestrel_plex_pin" {
		t.Fatalf("PIN cookies = %v", r.Cookie)
	}
	if c := r.Cookie[0]; !c.HttpOnly || c.SameSite != http.SameSiteLaxMode || c.Path != "/kestrel" || c.Secure || c.MaxAge != 15*60 {
		t.Errorf("PIN cookie = %+v, want HttpOnly, Lax, Path=/kestrel, 15 minutes", c)
	}
	pin := decode[struct {
		AuthURL string `json:"auth_url"`
	}](t, r)
	host := strings.TrimPrefix(h.srv.URL, "http://")
	forward := url.QueryEscape("http://" + host + "/kestrel/?plex=1")
	for _, want := range []string{h.tv.URL + "/auth#?clientID=", "code=" + code, "forwardUrl=" + forward, "context%5Bdevice%5D%5Bproduct%5D=Kestrel"} {
		if !strings.Contains(pin.AuthURL, want) {
			t.Errorf("auth_url %s lacks %s", pin.AuthURL, want)
		}
	}

	// Not authorised yet: try again shortly.
	if r := h.send(b, "POST", "/auth/plex/login"); r.Status != 409 || !strings.Contains(r.Body, `"code":"pending"`) {
		t.Fatalf("login before authorising = %d %s", r.Status, r.Body)
	}
	h.tv.Authorise(code, "anna-token")
	r = h.send(b, "POST", "/auth/plex/login")
	if r.Status != 204 || len(r.Cookie) != 2 {
		t.Fatalf("login = %d %v, want 204 with the session cookie and a cleared PIN cookie", r.Status, r.Cookie)
	}
	var session, cleared *http.Cookie
	for _, c := range r.Cookie {
		if c.Name == "kestrel_session" {
			session = c
		} else if c.Name == "kestrel_plex_pin" {
			cleared = c
		}
	}
	if session == nil || !session.HttpOnly || session.Path != "/kestrel" || cleared == nil || cleared.MaxAge >= 0 {
		t.Errorf("cookies = %v", r.Cookie)
	}

	me := b.get("/auth/me")
	if me.Status != 200 || !strings.Contains(me.Body, `"username":"anna"`) || !strings.Contains(me.Body, `"role":"requester"`) ||
		!strings.Contains(me.Body, `"method":"plex"`) || !strings.Contains(me.Body, `"from_config_file":false`) {
		t.Errorf("me = %d %s", me.Status, me.Body)
	}
	// The PIN is used up.
	if r := h.send(b, "POST", "/auth/plex/login"); r.Status != 401 {
		t.Errorf("login again with the used PIN = %d, want 401", r.Status)
	}

	// Kestrel introduces itself to plex.tv the same way every time.
	var ids = map[string]bool{}
	for _, c := range h.tv.Calls() {
		if c.Product != "Kestrel" || c.Version != "1.2.3" || c.ClientID == "" {
			t.Errorf("call %+v lacks Kestrel's headers", c)
		}
		ids[c.ClientID] = true
	}
	if len(ids) != 1 {
		t.Errorf("client identifiers = %v, want one", ids)
	}
}

func TestPlexClientIdentifierIsGeneratedOnceAndKept(t *testing.T) {
	t.Parallel()
	h := newHousehold(t, "")
	h.start(h.browser())
	first := h.tv.Calls()[0].ClientID
	h.restart()
	h.start(h.browser())
	calls := h.tv.Calls()
	if last := calls[len(calls)-1].ClientID; first == "" || last != first {
		t.Errorf("client identifier %q then %q, want it kept across a restart", first, last)
	}
}

func TestAPinOnlyFinishesInTheBrowserThatStartedIt(t *testing.T) {
	t.Parallel()
	h := newHousehold(t, "")
	mine, other := h.browser(), h.browser()
	code, _ := h.start(mine)
	h.tv.Authorise(code, "anna-token")

	for name, b := range map[string]*browser{"another browser": other, "no cookie": h.browser()} {
		if r := h.send(b, "POST", "/auth/plex/login"); r.Status != 401 || !strings.Contains(r.Body, `"code":"unauthenticated"`) {
			t.Errorf("%s = %d %s, want 401", name, r.Status, r.Body)
		}
	}
	if r := mine.valid("POST", "/auth/plex/login", ""); r.Status != 204 {
		t.Errorf("the browser that started it = %d %s", r.Status, r.Body)
	}
}

func TestAnExpiredPinAsksToStartAgain(t *testing.T) {
	t.Parallel()
	h := newHousehold(t, "")
	b := h.browser()
	code, _ := h.start(b)
	h.tv.Authorise(code, "anna-token")
	h.tv.ExpireAll()
	if r := h.send(b, "POST", "/auth/plex/login"); r.Status != 401 || !strings.Contains(r.Body, `"code":"unauthenticated"`) {
		t.Errorf("expired PIN = %d %s", r.Status, r.Body)
	}
}

func TestAnAccountWithoutAccessIsRefusedAndThrottled(t *testing.T) {
	t.Parallel()
	h := newHousehold(t, "")
	b := h.browser()
	for i := 1; i <= 5; i++ {
		r := h.signIn(b, "stranger-token")
		if r.Status != 403 || !strings.Contains(r.Body, `"code":"plex_no_access"`) || len(r.Cookie) != 1 || r.Cookie[0].Name != "kestrel_plex_pin" {
			t.Fatalf("attempt %d = %d %s %v", i, r.Status, r.Body, r.Cookie)
		}
	}
	// Five failures slow the address down, as for passwords, and the allowed ones with it.
	r := h.signIn(b, "anna-token")
	if r.Status != 429 || !strings.Contains(r.Body, `"code":"rate_limited"`) || r.Header.Get("Retry-After") == "" {
		t.Fatalf("after five failures = %d %v %s, want 429", r.Status, r.Header, r.Body)
	}
	if r := h.admin.valid("GET", "/auth/me", ""); r.Status != 200 {
		t.Errorf("the admin's session = %d", r.Status)
	}
	h.clock.Advance(time.Minute)
	if r := h.signIn(b, "anna-token"); r.Status != 204 {
		t.Errorf("after waiting = %d %s", r.Status, r.Body)
	}
}

func TestWhoHasAccessToTheServer(t *testing.T) {
	t.Parallel()
	h := newHousehold(t, "")
	h.tv.AddAccount("owner-token", plextvtest.Owner)
	h.tv.AddAccount("elsewhere-token", plextv.Account{ID: 20, Username: "elsewhere", Title: "Elsewhere"})
	h.tv.AddAccount("noshare-token", plextv.Account{ID: 21, Username: "noshare", Title: "No Share"})
	h.tv.Share(plextv.SharedUser{ID: 20, Username: "elsewhere", Title: "Elsewhere", Servers: []string{"somebody-elses-machine"}})
	h.tv.Share(plextv.SharedUser{ID: 21, Username: "noshare", Title: "No Share"})

	for _, c := range []struct {
		who, token string
		status     int
	}{
		{"the owner", "owner-token", 204},
		{"a friend with a share of this server", "anna-token", 204},
		{"a Plex Home member", "kim-token", 204},
		{"a friend with a share of another server", "elsewhere-token", 403},
		{"a friend with no share", "noshare-token", 403},
		{"someone the owner does not share with", "stranger-token", 403},
	} {
		h.clock.Advance(time.Hour) // the throttle forgets the refusals
		if r := h.signIn(h.browser(), c.token); r.Status != c.status {
			t.Errorf("%s = %d %s, want %d", c.who, r.Status, r.Body, c.status)
		}
	}
}

func TestTheListOfUsersNarrowsWhoMayRequestIgnoringCase(t *testing.T) {
	t.Parallel()
	h := newHousehold(t, "")
	h.putSignIn(`{"enabled":true,"instance":"Plex","users":["ANNA","kim"],"user_root_folders":[]}`)

	if r := h.signIn(h.browser(), "anna-token"); r.Status != 204 {
		t.Errorf("anna, by username = %d %s", r.Status, r.Body)
	}
	if r := h.signIn(h.browser(), "kim-token"); r.Status != 204 {
		t.Errorf("kim, a Home user, by name = %d %s", r.Status, r.Body)
	}
	if r := h.signIn(h.browser(), "ben-token"); r.Status != 403 || !strings.Contains(r.Body, `"code":"plex_no_access"`) {
		t.Errorf("ben, with access but not listed = %d %s", r.Status, r.Body)
	}
	// A user is also named by the account's display name.
	h.putSignIn(`{"enabled":true,"instance":"Plex","users":["anna smith"],"user_root_folders":[]}`)
	if r := h.signIn(h.browser(), "anna-token"); r.Status != 204 {
		t.Errorf("anna, by title = %d %s", r.Status, r.Body)
	}
}

func TestPlexBeingDownIsABadGatewayNotARefusal(t *testing.T) {
	t.Parallel()
	h := newHousehold(t, "")
	b := h.browser()
	h.tv.SetDown(true)
	if r := b.valid("POST", "/auth/plex/pin", ""); r.Status != 502 || !strings.Contains(r.Body, `"code":"upstream_unavailable"`) {
		t.Errorf("PIN while plex.tv is down = %d %s", r.Status, r.Body)
	}
	h.tv.SetDown(false)
	code, _ := h.start(b)
	h.tv.Authorise(code, "anna-token")
	h.tv.SetDown(true)
	if r := h.send(b, "POST", "/auth/plex/login"); r.Status != 502 || !strings.Contains(r.Body, `"code":"upstream_unavailable"`) {
		t.Errorf("login while plex.tv is down = %d %s", r.Status, r.Body)
	}
	h.tv.SetDown(false)
	if r := h.send(b, "POST", "/auth/plex/login"); r.Status != 204 {
		t.Errorf("login once it is back = %d %s: the PIN should still stand", r.Status, r.Body)
	}
}

func TestPlexRequesterIsConfinedToSearchingAndRequesting(t *testing.T) {
	t.Parallel()
	h := newHousehold(t, "")
	b := h.requester("anna-token")

	for _, c := range []struct{ method, path, body string }{
		{"GET", "/titles", ""},
		{"GET", "/titles/1", ""},
		{"GET", "/requests", ""},
		{"POST", "/requests", "{}"},
		{"GET", "/settings", ""},
		{"GET", "/settings/plex-sign-in", ""},
		{"PUT", "/settings/plex-sign-in", `{"enabled":false,"instance":null,"users":[],"user_root_folders":[]}`},
		{"GET", "/plugin-instances", ""},
		{"GET", "/api-key", ""},
		{"POST", "/api-key", ""},
		{"POST", "/account/password", `{"current_password":"correct horse","new_password":"brand new pass"}`},
		{"POST", "/auth/logout-everywhere", ""},
		{"GET", "/stream", ""},
		{"GET", "/lookup/movie/116149", ""},
		{"GET", "/does-not-exist", ""},
	} {
		if r := b.do(c.method, c.path, c.body); r.Status != 403 || !strings.Contains(r.Body, `"code":"forbidden"`) {
			t.Errorf("%s %s as a Requester = %d %s, want 403 forbidden", c.method, c.path, r.Status, r.Body)
		}
	}
	for _, path := range []string{"/auth/me", "/system", "/my/requests", "/titles/1/poster"} {
		if r := b.get(path); r.Status == 403 || r.Status == 401 {
			t.Errorf("GET %s as a Requester = %d, want it allowed", path, r.Status)
		}
	}
	// The admin's session is untouched by any of it.
	if r := h.admin.valid("GET", "/settings/plex-sign-in", ""); r.Status != 200 {
		t.Errorf("admin settings = %d", r.Status)
	}
	if r := b.post("/auth/logout", ""); r.Status != 204 {
		t.Errorf("a Requester logging out = %d", r.Status)
	}
	if r := b.get("/auth/me"); r.Status != 401 {
		t.Errorf("after logging out = %d, want 401", r.Status)
	}
}

func TestMeSaysWhoIsSignedIn(t *testing.T) {
	t.Parallel()
	h := newHousehold(t, "")
	if r := h.admin.valid("GET", "/auth/me", ""); !strings.Contains(r.Body, `"role":"admin"`) || !strings.Contains(r.Body, `"method":"session"`) {
		t.Errorf("admin me = %s", r.Body)
	}
	if r := h.requester("kim-token").valid("GET", "/auth/me", ""); !strings.Contains(r.Body, `"username":"Kim"`) || !strings.Contains(r.Body, `"role":"requester"`) {
		t.Errorf("a Home user without a username is called by name: %s", r.Body)
	}
}

func TestAnAPIKeyAndAProxyLoginAreTheAdmin(t *testing.T) {
	t.Parallel()
	h := newHousehold(t, "")
	key := decode[struct {
		Key string `json:"key"`
	}](t, h.admin.valid("POST", "/api-key", "")).Key
	r := h.call("GET", "/auth/me", "", map[string]string{"X-Api-Key": key})
	if r.Status != 200 || !strings.Contains(r.Body, `"role":"admin"`) || !strings.Contains(r.Body, `"method":"api_key"`) {
		t.Errorf("api key me = %d %s", r.Status, r.Body)
	}
	enableProxy(t, h.admin, "127.0.0.1")
	r = h.call("GET", "/auth/me", "", map[string]string{"Remote-User": "alice"})
	if r.Status != 200 || !strings.Contains(r.Body, `"role":"admin"`) || !strings.Contains(r.Body, `"method":"proxy"`) {
		t.Errorf("proxy me = %d %s", r.Status, r.Body)
	}
}

func TestARequestersAccessIsCheckedAgainAtMostOnceAnHour(t *testing.T) {
	t.Parallel()
	h := newHousehold(t, "")
	b := h.requester("anna-token")
	h.tv.Unshare(anna.ID)
	before := len(h.tv.Calls())

	h.clock.Advance(30 * time.Minute)
	if r := b.get("/auth/me"); r.Status != 200 {
		t.Fatalf("within the hour = %d, want the session kept", r.Status)
	}
	if n := len(h.tv.Calls()); n != before {
		t.Errorf("%d calls to Plex within the hour, want none", n-before)
	}
	h.clock.Advance(31 * time.Minute)
	r := b.get("/auth/me")
	if r.Status != 401 || !strings.Contains(r.Body, `"code":"unauthenticated"`) {
		t.Fatalf("after the hour, without access = %d %s, want 401", r.Status, r.Body)
	}
	if len(r.Cookie) != 1 || r.Cookie[0].MaxAge >= 0 {
		t.Errorf("cookies = %v, want the session cookie cleared", r.Cookie)
	}
	if r := b.get("/auth/me"); r.Status != 401 {
		t.Errorf("the ended session = %d", r.Status)
	}
}

func TestARequestersAccessConfirmedStaysForAnotherHour(t *testing.T) {
	t.Parallel()
	h := newHousehold(t, "")
	b := h.requester("anna-token")
	h.clock.Advance(61 * time.Minute)
	if r := b.get("/auth/me"); r.Status != 200 {
		t.Fatalf("re-check with access = %d", r.Status)
	}
	checked := len(h.tv.Calls())
	h.tv.Unshare(anna.ID)
	h.clock.Advance(59 * time.Minute)
	if r := b.get("/auth/me"); r.Status != 200 || len(h.tv.Calls()) != checked {
		t.Fatalf("59 minutes after the check = %d with %d new calls, want the session kept without asking", r.Status, len(h.tv.Calls())-checked)
	}
	h.clock.Advance(2 * time.Minute)
	if r := b.get("/auth/me"); r.Status != 401 {
		t.Errorf("an hour after the check = %d, want 401", r.Status)
	}
}

func TestAPlexOutageDoesNotEndARequestersSession(t *testing.T) {
	t.Parallel()
	h := newHousehold(t, "")
	b := h.requester("anna-token")

	h.tv.SetDown(true)
	h.clock.Advance(2 * time.Hour)
	if r := b.get("/auth/me"); r.Status != 200 {
		t.Fatalf("during the outage = %d, want the call let through", r.Status)
	}
	// While plex.tv stays down, the next calls do not each wait for it again.
	asked := len(h.tv.Calls())
	if r := b.get("/auth/me"); r.Status != 200 || len(h.tv.Calls()) != asked {
		t.Errorf("the next call = %d with %d new calls, want it let through without asking", r.Status, len(h.tv.Calls())-asked)
	}

	h.tv.SetDown(false)
	h.tv.Unshare(anna.ID)
	h.clock.Advance(2 * time.Minute)
	if r := b.get("/auth/me"); r.Status != 401 {
		t.Errorf("once Plex answers that the access is gone = %d, want 401", r.Status)
	}
}

func TestSwitchingPlexSignInOffEndsRequesterSessionsOnTheirNextCall(t *testing.T) {
	t.Parallel()
	h := newHousehold(t, "")
	b := h.requester("anna-token")
	h.putSignIn(`{"enabled":false,"instance":"Plex","users":[],"user_root_folders":[]}`)
	if r := b.get("/auth/me"); r.Status != 401 {
		t.Errorf("after switching off = %d, want 401", r.Status)
	}
	if r := h.admin.get("/auth/me"); r.Status != 200 {
		t.Errorf("the admin = %d", r.Status)
	}
	// Switched on again, the ended session stays ended.
	h.putSignIn(`{"enabled":true,"instance":"Plex","users":[],"user_root_folders":[]}`)
	if r := b.get("/auth/me"); r.Status != 401 {
		t.Errorf("after switching on again = %d, want the session gone", r.Status)
	}
}

func TestDeletingThePlexInstanceSwitchesSignInOff(t *testing.T) {
	t.Parallel()
	h := newHousehold(t, "")
	b := h.requester("anna-token")
	id := h.admin.instanceID(t, "plex")
	if r := h.admin.do("DELETE", "/plugin-instances/"+itoa(id), ""); r.Status != 204 {
		t.Fatalf("delete = %d %s", r.Status, r.Body)
	}
	if r := b.get("/auth/me"); r.Status != 401 {
		t.Errorf("after the instance went = %d, want 401", r.Status)
	}
	if r := h.browser().valid("GET", "/auth/plex", ""); !strings.Contains(r.Body, `"enabled":false`) {
		t.Errorf("availability = %s", r.Body)
	}
}

func TestTakingARequesterOffTheListOfUsersEndsTheirSession(t *testing.T) {
	t.Parallel()
	h := newHousehold(t, "")
	anna, ben := h.requester("anna-token"), h.requester("ben-token")
	h.putSignIn(`{"enabled":true,"instance":"Plex","users":["Ben"],"user_root_folders":[]}`)
	if r := anna.get("/auth/me"); r.Status != 401 {
		t.Errorf("anna, off the list = %d, want 401", r.Status)
	}
	if r := ben.get("/auth/me"); r.Status != 200 {
		t.Errorf("ben, still on it = %d", r.Status)
	}
}

func TestChangingTheAdminPasswordKeepsRequesterSessions(t *testing.T) {
	t.Parallel()
	h := newHousehold(t, "")
	b := h.requester("anna-token")
	elsewhere := h.login()

	if r := h.admin.post("/account/password", `{"current_password":"correct horse","new_password":"brand new pass"}`); r.Status != 204 {
		t.Fatalf("change = %d %s", r.Status, r.Body)
	}
	if r := elsewhere.get("/auth/me"); r.Status != 401 {
		t.Errorf("the other admin session = %d, want it ended", r.Status)
	}
	if r := b.get("/auth/me"); r.Status != 200 {
		t.Errorf("the Requester's session = %d, want it kept", r.Status)
	}
}

func TestLoggingOutEverywhereEndsRequesterSessionsToo(t *testing.T) {
	t.Parallel()
	h := newHousehold(t, "")
	b := h.requester("anna-token")
	if r := h.admin.post("/auth/logout-everywhere", ""); r.Status != 204 {
		t.Fatalf("logout-everywhere = %d", r.Status)
	}
	if r := b.get("/auth/me"); r.Status != 401 {
		t.Errorf("the Requester's session = %d, want it ended", r.Status)
	}
}

func TestTheSessionCookieIsSecureBehindATLSProxyAndSoIsThePinCookie(t *testing.T) {
	t.Parallel()
	h := newHousehold(t, "")
	trustForAddresses(t, h.admin, "127.0.0.1")
	req, _ := http.NewRequest("POST", h.srv.URL+"/api/v1/auth/plex/pin", strings.NewReader(""))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Forwarded-Proto", "https")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	cs := res.Cookies()
	if len(cs) != 1 || !cs[0].Secure {
		t.Fatalf("cookies = %v, want one Secure PIN cookie", cs)
	}
	var pin struct {
		AuthURL string `json:"auth_url"`
	}
	if err := json.NewDecoder(res.Body).Decode(&pin); err != nil {
		t.Fatal(err)
	}
	host := strings.TrimPrefix(h.srv.URL, "http://")
	if !strings.Contains(pin.AuthURL, url.QueryEscape("https://"+host+"/?plex=1")) {
		t.Errorf("auth_url %s should send the browser back over https", pin.AuthURL)
	}
}
