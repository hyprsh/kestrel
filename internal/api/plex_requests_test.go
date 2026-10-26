package api_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/app"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
	"github.com/hyprsh/kestrel/internal/plextv"
	"github.com/hyprsh/kestrel/internal/plextv/plextvtest"
)

// requesterLibrary is a household whose Kestrel has the fake TMDB and TheTVDB, and the default Root folders.
func requesterLibrary(t *testing.T) (*plexHousehold, library) {
	t.Helper()
	tv, tmdb, tvdb := plextvtest.New(t), metadatatest.New(t), metadatatest.NewTVDB(t)
	data, config := t.TempDir(), t.TempDir()
	in := newInstance(t, "", withPlex(t, tv), func(o *app.Options) {
		o.DataDir, o.ConfigDir = data, config
		o.Metadata = metadata.NewTMDB(metadata.TMDBOptions{BaseURL: tmdb.APIBase(), ImageBase: tmdb.ImageBase(), Keys: metadata.StaticKey(metadatatest.Key)})
		o.TVDB = metadata.NewTVDB(metadata.TVDBOptions{BaseURL: tvdb.APIBase(), Keys: metadata.StaticTVDBKey(metadatatest.TVDBKey)})
		o.Posters = metadata.NewPosters(metadata.PostersOptions{ConfigDir: config, ImageBase: tmdb.ImageBase()})
	})
	admin := in.setUp()
	return householdOf(t, in, tv, admin), library{browser: admin, tmdb: tmdb, tvdb: tvdb, config: config, data: data}
}

type myRequestJSON struct {
	requestJSON
	SourceRequestID string `json:"source_request_id"`
	RejectReasonStr string `json:"reject_reason"`
}

const paddington = `{"kind":"movie","tmdb_id":116149}`

func TestARequesterRequestsATitleAsThePlexAccountAndAskingAgainReturnsTheStoredRequest(t *testing.T) {
	t.Parallel()
	h, l := requesterLibrary(t)
	b := h.requester("anna-token")

	r := b.valid("POST", "/my/requests", paddington)
	if r.Status != 201 {
		t.Fatalf("POST /my/requests = %d %s", r.Status, r.Body)
	}
	req := decode[myRequestJSON](t, r)
	if req.Source != "plex" || req.SourceRequestID != "10-movie-116149" || req.Requester.ID != "10" || req.Requester.Name != "anna" || req.Outcome != "accepted" || req.TitleID == nil {
		t.Fatalf("request = %+v", req)
	}
	if len(req.Slots) != 1 {
		t.Fatalf("slots = %+v, want the Standard Slot alone", req.Slots)
	}
	if st, _, profile, _ := req.slot(t, "standard"); st != "queued" || profile != "hd-primary" {
		t.Errorf("standard = %s %s, want it queued under the resolved Profile", st, profile)
	}

	again := b.valid("POST", "/my/requests", paddington)
	if again.Status != 200 || decode[requestJSON](t, again).ID != req.ID {
		t.Errorf("asking again = %d %s, want 200 and the stored Request", again.Status, again.Body)
	}

	// The admin sees it like any Request: in the list, the Title's origins and the Log.
	list := decode[requestListJSON](t, l.valid("GET", "/requests?source=plex", ""))
	if len(list.Items) != 1 || list.Items[0].ID != req.ID {
		t.Errorf("GET /requests = %+v", list.Items)
	}
	if r := l.valid("GET", "/events", ""); !strings.Contains(r.Body, "Request from anna via Plex") {
		t.Errorf("the Log lacks the Request: %s", r.Body)
	}
}

func TestEachRequesterHasTheirOwnRequestForTheSameTitle(t *testing.T) {
	t.Parallel()
	h, _ := requesterLibrary(t)
	// Another account whose name is the same as anna's, ignoring case: the id decides, not the name.
	twin := plextv.Account{ID: 13, Username: "ANNA", Title: "Anna's twin"}
	h.tv.AddAccount("twin-token", twin)
	h.tv.Share(plextv.SharedUser{ID: twin.ID, Username: twin.Username, Title: twin.Title, Servers: []string{plextvtest.Machine}})
	annaB, benB, twinB := h.requester("anna-token"), h.requester("ben-token"), h.requester("twin-token")

	first := decode[requestJSON](t, annaB.valid("POST", "/my/requests", paddington))
	second := decode[requestJSON](t, benB.valid("POST", "/my/requests", paddington))
	third := decode[requestJSON](t, twinB.valid("POST", "/my/requests", paddington))
	if first.ID == second.ID || first.ID == third.ID || second.ID == third.ID || *first.TitleID != *second.TitleID || *first.TitleID != *third.TitleID {
		t.Fatalf("requests = %+v %+v %+v, want one each for the same Title", first, second, third)
	}

	for name, c := range map[string]struct {
		b    *browser
		want int64
	}{"anna": {annaB, first.ID}, "ben": {benB, second.ID}, "the twin": {twinB, third.ID}} {
		page := decode[struct {
			requestListJSON
			Total int `json:"total"`
		}](t, c.b.valid("GET", "/my/requests", ""))
		if len(page.Items) != 1 || page.Items[0].ID != c.want || page.Total != 1 {
			t.Errorf("%s sees %+v (total %d), want only Request %d", name, page.Items, page.Total, c.want)
		}
	}
}

func TestOnlyPlexRequestsAreListedAsARequestersOwn(t *testing.T) {
	t.Parallel()
	h, l := requesterLibrary(t)
	b := h.requester("anna-token")
	// A Silo Request that happens to carry the same requester id is not hers.
	l.valid("POST", "/requests", `{"source":"silo","source_request_id":"s-1","requester":{"id":"10","name":"anna"},"title":{"kind":"movie","tmdb_id":116149},"slots":[{"slot":"standard"}]}`)
	if page := decode[requestListJSON](t, b.valid("GET", "/my/requests", "")); len(page.Items) != 0 {
		t.Fatalf("my requests = %+v, want none", page.Items)
	}
	decode[requestJSON](t, b.valid("POST", "/my/requests", paddington))
	if page := decode[requestListJSON](t, b.valid("GET", "/my/requests", "")); len(page.Items) != 1 || page.Items[0].Source != "plex" {
		t.Errorf("my requests = %+v", page.Items)
	}
}

func TestMyRequestsArePagedNewestFirst(t *testing.T) {
	t.Parallel()
	h, _ := requesterLibrary(t)
	b := h.requester("anna-token")
	first := decode[requestJSON](t, b.valid("POST", "/my/requests", paddington))
	second := decode[requestJSON](t, b.valid("POST", "/my/requests", `{"kind":"movie","tmdb_id":999999}`)) // unknown to TMDB: rejected, but still hers
	if second.Outcome != "rejected" || second.RejectReason == nil || *second.RejectReason != "unknown_title" {
		t.Fatalf("unknown title = %+v", second)
	}

	page := decode[struct {
		requestListJSON
		NextCursor *string `json:"next_cursor"`
	}](t, b.valid("GET", "/my/requests?limit=1", ""))
	if len(page.Items) != 1 || page.Items[0].ID != second.ID || page.NextCursor == nil {
		t.Fatalf("page 1 = %+v %v", page.Items, page.NextCursor)
	}
	next := decode[requestListJSON](t, b.valid("GET", "/my/requests?limit=1&cursor="+*page.NextCursor, ""))
	if len(next.Items) != 1 || next.Items[0].ID != first.ID {
		t.Errorf("page 2 = %+v", next.Items)
	}
	if r := b.valid("GET", "/my/requests?limit=0", ""); r.Status != 422 {
		t.Errorf("limit 0 = %d, want 422", r.Status)
	}
}

func TestAMalformedMyRequestIs422(t *testing.T) {
	t.Parallel()
	h, _ := requesterLibrary(t)
	b := h.requester("anna-token")
	for _, body := range []string{`{"kind":"book","tmdb_id":1}`, `{"kind":"movie","tmdb_id":0}`, `{"kind":"movie","tmdb_id":-4}`} {
		if r := b.valid("POST", "/my/requests", body); r.Status != 422 {
			t.Errorf("POST %s = %d %s, want 422", body, r.Status, r.Body)
		}
	}
}

func TestARequestersRequestsGoToTheirRootFolderWhenTheyHaveOne(t *testing.T) {
	t.Parallel()
	h, l := requesterLibrary(t)
	movies, series := l.moreFolders(t)
	h.putSignIn(fmt.Sprintf(`{"enabled":true,"instance":"Plex","users":[],"user_root_folders":[`+
		`{"user":"ANNA","movies":%q,"series":null},{"user":"Kim","movies":%q,"series":%q}]}`, movies, movies, series))

	for _, c := range []struct {
		token, kind string
		tmdb        int
		want        string
	}{
		{"anna-token", "movie", 116149, movies}, // by username, ignoring case
		{"ben-token", "movie", 116149, movies},  // the Title exists now: its folder stays
	} {
		r := h.requester(c.token).valid("POST", "/my/requests", fmt.Sprintf(`{"kind":%q,"tmdb_id":%d}`, c.kind, c.tmdb))
		if got := l.rootFolderOf(t, r); got != c.want {
			t.Errorf("%s's %s Request: root folder = %q, want %q", c.token, c.kind, got, c.want)
		}
	}

	// A user with no folders for the kind, or none at all, gets the kind's first.
	annaSeries := h.requester("anna-token").valid("POST", "/my/requests", `{"kind":"series","tmdb_id":7001}`)
	if got := l.rootFolderOf(t, annaSeries); got != l.data+"/media/tv" {
		t.Errorf("anna's Series: root folder = %q, want the first", got)
	}
	// A Home user is matched by name.
	kimSeries := h.requester("kim-token").valid("POST", "/my/requests", `{"kind":"series","tmdb_id":1396}`)
	if got := l.rootFolderOf(t, kimSeries); got != series {
		t.Errorf("kim's Series: root folder = %q, want %q", got, series)
	}
}

func TestARequestersFolderThatLeftTheRootFoldersFallsBackToTheFirst(t *testing.T) {
	t.Parallel()
	h, l := requesterLibrary(t)
	movies, series := l.moreFolders(t)
	h.putSignIn(fmt.Sprintf(`{"enabled":true,"instance":"Plex","users":[],"user_root_folders":[{"user":"anna","movies":%q,"series":null}]}`, movies))
	l.valid("PATCH", "/settings", fmt.Sprintf(`{"root_folders":{"movies":[%q],"series":[%q]}}`, l.data+"/media/movies", series))

	r := h.requester("anna-token").valid("POST", "/my/requests", paddington)
	if r.Status != 201 {
		t.Fatalf("POST = %d %s", r.Status, r.Body)
	}
	if got := l.rootFolderOf(t, r); got != l.data+"/media/movies" {
		t.Errorf("root folder = %q, want the first", got)
	}
}

func TestOnlyARequestersSessionMayUseMyRequests(t *testing.T) {
	t.Parallel()
	h, l := requesterLibrary(t)
	key := decode[struct {
		Key string `json:"key"`
	}](t, l.valid("POST", "/api-key", "")).Key
	enableProxy(t, l.browser, "127.0.0.1")

	for _, c := range []struct {
		who     string
		headers map[string]string
		cookies *browser
	}{
		{"the admin", nil, l.browser},
		{"an API key", map[string]string{"X-Api-Key": key}, nil},
		{"a proxy login", map[string]string{"Remote-User": "alice"}, nil},
	} {
		for _, call := range []struct{ method, body string }{{"GET", ""}, {"POST", paddington}} {
			var r reply
			if c.cookies != nil {
				r = c.cookies.valid(call.method, "/my/requests", call.body)
			} else {
				headers := map[string]string{"Content-Type": "application/json"}
				for k, v := range c.headers {
					headers[k] = v
				}
				r = h.call(call.method, "/my/requests", call.body, headers)
			}
			if r.Status != 403 || !strings.Contains(r.Body, `"code":"forbidden"`) {
				t.Errorf("%s: %s /my/requests = %d %s, want 403 forbidden", c.who, call.method, r.Status, r.Body)
			}
		}
	}
	if r := h.browser().get("/my/requests"); r.Status != 401 {
		t.Errorf("without a login = %d, want 401", r.Status)
	}
}

func TestARequesterSearchesAndSeesPostersButNotTheLibrary(t *testing.T) {
	t.Parallel()
	h, _ := requesterLibrary(t)
	b := h.requester("anna-token")

	r := b.valid("GET", "/lookup?q=paddington", "")
	if r.Status != 200 || !strings.Contains(r.Body, `"tmdb_id":116149`) {
		t.Fatalf("lookup = %d %s", r.Status, r.Body)
	}
	req := decode[requestJSON](t, b.valid("POST", "/my/requests", paddington))
	if r := b.get(fmt.Sprintf("/titles/%d/poster", *req.TitleID)); r.Status == 403 || r.Status == 401 {
		t.Errorf("poster = %d, want it allowed", r.Status)
	}
	if r := b.get(fmt.Sprintf("/titles/%d", *req.TitleID)); r.Status != 403 {
		t.Errorf("title detail = %d, want 403", r.Status)
	}
}
