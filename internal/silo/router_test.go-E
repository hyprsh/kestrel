package silo_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"testing"

	pluginv1 "github.com/Silo-Server/silo-plugin-sdk/pkg/pluginproto/silo/plugin/v1"
	"google.golang.org/protobuf/types/known/structpb"

	"github.com/hyprsh/kestrel/internal/api"
	"github.com/hyprsh/kestrel/internal/jobs"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
	"github.com/hyprsh/kestrel/internal/silo"
)

func conn(t *testing.T, base, key string, config map[string]any) *pluginv1.RouterConnection {
	t.Helper()
	cfg, err := structpb.NewStruct(config)
	if err != nil {
		t.Fatal(err)
	}
	return &pluginv1.RouterConnection{Id: "kestrel-1", BaseUrl: base, ApiKey: key, Config: cfg}
}

func movie(user int64) *pluginv1.RequestDescriptor {
	return &pluginv1.RequestDescriptor{
		MediaType: "movie", Title: "Paddington", Year: 2014, RequesterUserId: user, RequesterUsername: "anna",
		ExternalIds: map[string]string{"tmdb": strconv.Itoa(paddingtonTMDB), "imdb": "tt1109624"},
	}
}

func tiers(ids ...string) []*pluginv1.RequestedQuality {
	var out []*pluginv1.RequestedQuality
	for _, id := range ids {
		out = append(out, &pluginv1.RequestedQuality{Id: id, Is4K: id == "2160p"})
	}
	return out
}

func fulfil(t *testing.T, r *silo.Router, c *pluginv1.RouterConnection, d *pluginv1.RequestDescriptor, q ...string) *pluginv1.FulfillResponse {
	t.Helper()
	res, err := r.Fulfill(context.Background(), &pluginv1.FulfillRequest{
		CapabilityId: "kestrel", Request: d, Qualities: tiers(q...), Connections: []*pluginv1.RouterConnection{c},
	})
	if err != nil {
		t.Fatalf("Fulfill: %v", err)
	}
	return res
}

func check(t *testing.T, r *silo.Router, c *pluginv1.RouterConnection, d *pluginv1.RequestDescriptor, targets []*pluginv1.FulfillmentTarget) map[string]*pluginv1.TargetStatus {
	t.Helper()
	var refs []*pluginv1.TargetRef
	for _, tg := range targets {
		refs = append(refs, &pluginv1.TargetRef{Quality: tg.Quality, ConnectionId: tg.ConnectionId, ExternalId: tg.ExternalId})
	}
	res, err := r.CheckStatus(context.Background(), &pluginv1.CheckStatusRequest{
		CapabilityId: "kestrel", Request: d, Targets: refs, Connections: []*pluginv1.RouterConnection{c},
	})
	if err != nil {
		t.Fatalf("CheckStatus: %v", err)
	}
	out := map[string]*pluginv1.TargetStatus{}
	for _, s := range res.Statuses {
		out[s.Quality] = s
	}
	return out
}

func target(t *testing.T, res *pluginv1.FulfillResponse, quality string) *pluginv1.FulfillmentTarget {
	t.Helper()
	for _, tg := range res.Targets {
		if tg.Quality == quality {
			return tg
		}
	}
	t.Fatalf("no %s target in %+v", quality, res.Targets)
	return nil
}

type reqJSON struct {
	Outcome string `json:"outcome"`
	TitleID int64  `json:"title_id"`
	Source  string `json:"source"`
	Slots   []struct {
		Slot      string  `json:"slot"`
		Profile   *string `json:"profile"`
		VersionID *int64  `json:"version_id"`
	} `json:"slots"`
	Requester struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"requester"`
}

// requestOf reads the Kestrel Request behind a target, straight from the API.
func requestOf(t *testing.T, k *kestrel, tg *pluginv1.FulfillmentTarget) reqJSON {
	t.Helper()
	req, _ := http.NewRequest("GET", k.URL()+"/api/v1/requests/"+tg.ExternalId, nil)
	req.Header.Set("X-Api-Key", k.Key)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var out reqJSON
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("%v in %s", err, raw)
	}
	return out
}

func TestASiloRequestFrom4KUserBecomesAKestrelRequestWithStandardAnd4K(t *testing.T) {
	k := newKestrel(t)
	r := silo.NewRouter(silo.Options{})
	c := conn(t, k.URL(), k.Key, nil)

	res := fulfil(t, r, c, movie(7), "1080p", "2160p")

	if len(res.Targets) != 2 {
		t.Fatalf("targets = %+v, want Standard and 4K", res.Targets)
	}
	for _, q := range []string{"1080p", "2160p"} {
		tg := target(t, res, q)
		if tg.Status != "queued" || tg.ConnectionId != "kestrel-1" || tg.ExternalId == "" {
			t.Errorf("%s target = %+v", q, tg)
		}
	}
	req := requestOf(t, k, target(t, res, "1080p"))
	got := map[string]string{}
	for _, s := range req.Slots {
		got[s.Slot] = *s.Profile
	}
	if len(got) != 2 || got["standard"] == "" || got["4k"] == "" {
		t.Errorf("slots = %v, want standard and 4k with resolved Profiles", got)
	}
	if req.Source != "silo" || req.Requester.Name != "anna" || req.Requester.ID != "7" {
		t.Errorf("request = %+v, want it to say Anna asked via Silo", req)
	}
}

func TestA1080pOnlyRequestAddsOnlyTheStandardSlot(t *testing.T) {
	k := newKestrel(t)
	r := silo.NewRouter(silo.Options{})

	standardOnly := fulfil(t, r, conn(t, k.URL(), k.Key, nil), movie(7), "1080p")
	if len(standardOnly.Targets) != 1 || standardOnly.Targets[0].Quality != "1080p" {
		t.Fatalf("targets = %+v", standardOnly.Targets)
	}
	if slots := requestOf(t, k, standardOnly.Targets[0]).Slots; len(slots) != 1 || slots[0].Slot != "standard" {
		t.Errorf("slots = %+v, want standard only", slots)
	}
}

func TestConfiguredProfilesAreRequestedPerSlotAndListedAsOptions(t *testing.T) {
	k := newKestrel(t)
	more := k.moreMovies()
	r := silo.NewRouter(silo.Options{})
	c := conn(t, k.URL(), k.Key, nil)

	opts, err := r.ListConfigOptions(context.Background(), &pluginv1.ListConfigOptionsRequest{CapabilityId: "kestrel", Connection: c})
	if err != nil {
		t.Fatal(err)
	}
	if len(opts.OptionsByField) != 3 {
		t.Errorf("fields = %v, want exactly standard_profile, 4k_profile and root_folder", opts.OptionsByField)
	}
	std := opts.OptionsByField["standard_profile"].GetOptions()
	uhd := opts.OptionsByField["4k_profile"].GetOptions()
	if len(std) < 2 || std[0].Value != "" || std[0].Label != "Kestrel default" || len(uhd) < 2 {
		t.Fatalf("standard = %v, 4k = %v, want Kestrel default first and the Slot's Profiles after", std, uhd)
	}
	roots := opts.OptionsByField["root_folder"].GetOptions()
	var paths []string
	for _, o := range roots {
		paths = append(paths, o.Value)
	}
	if len(roots) < 2 || roots[0].Value != "" || roots[0].Label != "Kestrel default" || !slices.Contains(paths, more) {
		t.Errorf("root folders = %v, want Kestrel default first and the folders Kestrel has, including %s", paths, more)
	}
	pick := std[len(std)-1].Value
	uhdPick := uhd[len(uhd)-1].Value

	res := fulfil(t, r, conn(t, k.URL(), k.Key, map[string]any{"standard_profile": pick, "4k_profile": uhdPick}), movie(7), "1080p", "2160p")
	got := map[string]string{}
	for _, s := range requestOf(t, k, res.Targets[0]).Slots {
		got[s.Slot] = *s.Profile
	}
	if got["standard"] != pick || got["4k"] != uhdPick {
		t.Errorf("profiles = %v, want standard=%s 4k=%s", got, pick, uhdPick)
	}
}

func TestARouteOverrideOfRootFolderAndProfileFilesTheTitleThere(t *testing.T) {
	k := newKestrel(t)
	more := k.moreMovies()
	r := silo.NewRouter(silo.Options{})
	c := conn(t, k.URL(), k.Key, map[string]any{"root_folder": more, "standard_profile": "any-original"})

	res := fulfil(t, r, c, movie(7), "1080p")
	req := requestOf(t, k, res.Targets[0])
	if got := k.rootFolderOf(req); got != more {
		t.Errorf("root folder = %q, want %q", got, more)
	}
	if len(req.Slots) != 1 || req.Slots[0].Slot != "standard" || *req.Slots[0].Profile != "any-original" {
		t.Errorf("slots = %+v, want standard with any-original", req.Slots)
	}

	// The 2160p tier carries its own override: the Title is already there, so
	// the folder it names is ignored and only the 4K Version is added.
	other := conn(t, k.URL(), k.Key, map[string]any{"root_folder": k.Data + "/media/movies", "4k_profile": "4k-original"})
	res = fulfil(t, r, other, movie(7), "2160p")
	req = requestOf(t, k, res.Targets[0])
	if got := k.rootFolderOf(req); got != more {
		t.Errorf("root folder after the 4K tier = %q, want it left at %q", got, more)
	}
	has4K := false
	for _, sl := range req.Slots {
		has4K = has4K || (sl.Slot == "4k" && *sl.Profile == "4k-original")
	}
	if !has4K {
		t.Errorf("slots = %+v, want a 4k Version under 4k-original", req.Slots)
	}
}

func TestARootFolderKestrelDoesNotHaveIsAFailedRequest(t *testing.T) {
	k := newKestrel(t)
	r := silo.NewRouter(silo.Options{})
	c := conn(t, k.URL(), k.Key, map[string]any{"root_folder": k.Data + "/nowhere"})

	res, err := r.Fulfill(context.Background(), &pluginv1.FulfillRequest{
		CapabilityId: "kestrel", Request: movie(7), Qualities: tiers("1080p"), Connections: []*pluginv1.RouterConnection{c},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Targets) != 0 || !strings.Contains(res.Message, "Root folder") {
		t.Errorf("response = %+v, want no targets and Kestrel's refusal", res)
	}
}

// TestAFailedOptionsProbeNamesWhatSiloShowsTheAdminAbout checks the error text
// against the phrases Silo's options probe looks for
// (internal/requests/integration_probe.go) to mark the base URL or API key
// field instead of answering "could not be reached". Silo lower-cases the
// message for all but the HTTP status match; the phrases are checked here in the
// case the code emits, which is stricter.
func TestAFailedOptionsProbeNamesWhatSiloShowsTheAdminAbout(t *testing.T) {
	answer := func(code int, body string) string {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(code)
			_, _ = io.WriteString(w, body)
		}))
		t.Cleanup(srv.Close)
		return srv.URL
	}
	for _, tc := range []struct {
		name, base, key string
		want            []string
	}{
		{"no base URL", "", "kst_x", []string{"base URL is required"}},
		{"no host", "http://", "kst_x", []string{"base URL is required"}},
		{"not an http URL", "ftp://kestrel.lan", "kst_x", []string{"unsupported protocol scheme"}},
		{"no API key", "http://kestrel.lan", "", []string{"API key is required"}},
		{"a rejected key", answer(http.StatusUnauthorized, `{"detail":"invalid API key"}`), "kst_x", []string{"HTTP 401"}},
		{"no Kestrel API there", answer(http.StatusNotFound, ""), "kst_x", []string{"HTTP 404"}},
		{"a web page there", answer(http.StatusOK, "<!doctype html>"), "kst_x", []string{"decode response", "invalid character '<'"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := silo.NewRouter(silo.Options{})
			_, err := r.ListConfigOptions(context.Background(), &pluginv1.ListConfigOptionsRequest{
				CapabilityId: "kestrel", Connection: conn(t, tc.base, tc.key, nil),
			})
			if err == nil {
				t.Fatal("ListConfigOptions succeeded")
			}
			for _, w := range tc.want {
				if !strings.Contains(err.Error(), w) {
					t.Errorf("error = %q, want it to contain %q", err, w)
				}
			}
		})
	}
}

func TestRepeatingAFulfilConvergesOnTheSameKestrelRequest(t *testing.T) {
	k := newKestrel(t)
	r := silo.NewRouter(silo.Options{})
	c := conn(t, k.URL(), k.Key, nil)

	a := fulfil(t, r, c, movie(7), "1080p", "2160p")
	b := fulfil(t, r, c, movie(7), "1080p", "2160p")

	if a.Targets[0].ExternalId != b.Targets[0].ExternalId {
		t.Errorf("external ids %s then %s, want the same Request", a.Targets[0].ExternalId, b.Targets[0].ExternalId)
	}
}

func TestAKestrelRejectionIsAFailedTargetWithAMessage(t *testing.T) {
	k := newKestrel(t)
	r := silo.NewRouter(silo.Options{})
	d := movie(7)
	d.ExternalIds = map[string]string{"tmdb": "999999999"}

	res := fulfil(t, r, conn(t, k.URL(), k.Key, nil), d, "1080p")

	if len(res.Targets) != 1 || res.Targets[0].Status != "failed" || res.Targets[0].Message == "" {
		t.Errorf("targets = %+v, want one failed target saying why", res.Targets)
	}
}

func TestStatusAndProgressRoundTripFromQueuedThroughDownloadingToCompleted(t *testing.T) {
	k := newKestrel(t)
	k.publish(paddingtonHD)
	r := silo.NewRouter(silo.Options{})
	c := conn(t, k.URL(), k.Key, nil)
	d := movie(7)

	res := fulfil(t, r, c, d, "1080p", "2160p")

	st := check(t, r, c, d, res.Targets)
	if hd := st["1080p"]; hd.Status != "queued" || hd.Progress != nil {
		t.Errorf("before the grab: %+v", hd)
	}

	id := k.grab(paddingtonHD)
	if err := k.sab.SetPhase(id, downloadclient.PhaseDownloading, 250); err != nil {
		t.Fatal(err)
	}
	k.pass(jobs.Poll)

	st = check(t, r, c, d, res.Targets)
	hd := st["1080p"]
	if hd.Status != "downloading" || hd.Progress == nil || hd.Progress.Phase != "downloading" ||
		hd.Progress.BytesTotal != 1000 || hd.Progress.BytesLeft != 250 || hd.Progress.Downloads != 1 {
		t.Errorf("downloading: %+v", hd)
	}
	if uhd := st["2160p"]; uhd.Status != "queued" || uhd.Progress != nil {
		t.Errorf("the UHD Version has nothing downloading yet: %+v", uhd)
	}

	var hdVersion int64
	for _, sl := range requestOf(t, k, target(t, res, "1080p")).Slots {
		if sl.Slot == "standard" {
			hdVersion = *sl.VersionID
		}
	}
	if _, err := k.st.Write().Exec(`INSERT INTO files (version_id, path, size, release_name, imported_at) VALUES (?, '/x.mkv', 1, 'x', '2026-10-17T12:00:00Z')`, hdVersion); err != nil {
		t.Fatal(err)
	}
	st = check(t, r, c, d, res.Targets)
	if done := st["1080p"]; done.Status != "completed" || done.Progress != nil {
		t.Errorf("after the file: %+v", done)
	}
}

func TestTestConnectionComparesAPIMajorAndChecksTheKey(t *testing.T) {
	k := newKestrel(t)
	r := silo.NewRouter(silo.Options{})
	test := func(c *pluginv1.RouterConnection) *pluginv1.TestConnectionResponse {
		res, err := r.TestConnection(context.Background(), &pluginv1.TestConnectionRequest{CapabilityId: "kestrel", Connection: c})
		if err != nil {
			t.Fatal(err)
		}
		return res
	}

	if res := test(conn(t, k.URL(), k.Key, nil)); !res.Ok {
		t.Errorf("good connection: %+v", res)
	}
	if res := test(conn(t, k.URL(), "kst_wrong", nil)); res.Ok || res.Message == "" {
		t.Errorf("wrong key: %+v", res)
	}

	newer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprintf(w, `{"version":"2.0.0","api_major":%d,"base_url":""}`, api.Major+1)
	}))
	defer newer.Close()
	if res := test(conn(t, newer.URL, "kst_x", nil)); res.Ok || res.Message == "" {
		t.Errorf("mismatched api_major: %+v", res)
	}
}

func TestAPIMajorMatchesTheServer(t *testing.T) {
	if silo.APIMajor != api.Major {
		t.Fatalf("silo.APIMajor = %d, api.Major = %d", silo.APIMajor, api.Major)
	}
}

func TestASeriesRequestSendsTheRequestedSeasonsAndTheTVDBID(t *testing.T) {
	var body map[string]any
	stub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&body)
		w.WriteHeader(201)
		fmt.Fprint(w, `{"id":5,"outcome":"accepted","reject_reason":null,"slots":[{"slot":"standard","profile":"hd-primary","status":"queued","status_label":"Searching","download":null}]}`)
	}))
	defer stub.Close()
	r := silo.NewRouter(silo.Options{})
	d := &pluginv1.RequestDescriptor{
		MediaType: "series", Title: "Bluey", RequesterUserId: 3, RequesterUsername: "ben", Seasons: []int32{0, 2},
		ExternalIds: map[string]string{"tvdb": "81189", "tmdb": "1396"},
	}

	res := fulfil(t, r, conn(t, stub.URL, "kst_x", nil), d, "1080p")

	if len(res.Targets) != 1 || res.Targets[0].ExternalId != "5" {
		t.Fatalf("targets = %+v", res.Targets)
	}
	title := body["title"].(map[string]any)
	if title["kind"] != "series" || title["tvdb_id"] != float64(81189) || title["tmdb_id"] != float64(1396) {
		t.Errorf("title = %v", title)
	}
	if fmt.Sprint(body["seasons"]) != "[0 2]" {
		t.Errorf("seasons = %v, want [0 2]", body["seasons"])
	}

	body = nil
	d.Seasons = nil
	fulfil(t, r, conn(t, stub.URL, "kst_x", nil), d, "1080p")
	if body["seasons"] != nil {
		t.Errorf("seasons = %v, want none for the whole Series", body["seasons"])
	}
}

func TestTheManifestDeclaresSeasonsAndProgress(t *testing.T) {
	m, err := silo.Manifest("1.2.3")
	if err != nil {
		t.Fatal(err)
	}
	if m.GetVersion() != "1.2.3" || len(m.GetCapabilities()) != 1 || m.GetCapabilities()[0].GetType() != "request_router.v1" {
		t.Fatalf("manifest = %+v", m)
	}
	d := m.GetCapabilities()[0].GetRequestRouter()
	if !d.GetSupportsSeasons() || !d.GetReportsDownloadProgress() {
		t.Errorf("descriptor = %+v", d)
	}
}
