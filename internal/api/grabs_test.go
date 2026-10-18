package api_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/app"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
	"github.com/hyprsh/kestrel/internal/plugin"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
	dcfake "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1/fake"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	ixfake "github.com/hyprsh/kestrel/internal/plugin/indexer/v1/fake"
)

type releaseJSON struct {
	ReleaseID     string   `json:"release_id"`
	Name          string   `json:"name"`
	Indexer       string   `json:"indexer"`
	Size          int64    `json:"size"`
	Quality       string   `json:"quality"`
	Languages     []string `json:"languages"`
	CustomFormats []struct {
		Name   string `json:"name"`
		Points int    `json:"points"`
	} `json:"custom_formats"`
	Score      int    `json:"score"`
	Fits       string `json:"fits"`
	Rejections []struct {
		Code        string `json:"code"`
		Message     string `json:"message"`
		Overridable bool   `json:"overridable"`
	} `json:"rejections"`
}

type releaseListJSON struct {
	Items         []releaseJSON `json:"items"`
	IndexerErrors []struct {
		Indexer    string `json:"indexer"`
		Code       string `json:"code"`
		RetryAfter *int   `json:"retry_after"`
	} `json:"indexer_errors"`
}

type grabJSON struct {
	ID          int64  `json:"id"`
	TitleID     *int64 `json:"title_id"`
	VersionID   *int64 `json:"version_id"`
	ReleaseName string `json:"release_name"`
	Indexer     string `json:"indexer"`
	ClientID    string `json:"client_id"`
	State       string `json:"state"`
	Overridden  bool   `json:"overridden"`
}

type problemJSON struct {
	Code string `json:"code"`
}

// search is Kestrel with the TMDB fake, an indexer fake and a download-client fake, and the
// Movie Paddington added in HD and UHD.
type search struct {
	library
	idx     *ixfake.Indexer
	sab     *dcfake.Client
	hd, uhd int64
	title   int64
	prober  *stubProber
}

func newSearch(t *testing.T) search {
	t.Helper()
	s := newSearchBare(t)
	s.addPaddington(t)
	return s
}

// newSearchBare is newSearch before any Title is added.
func newSearchBare(t *testing.T, with ...func(*app.Options)) search {
	t.Helper()
	tmdb := metadatatest.New(t)
	data, config := t.TempDir(), t.TempDir()
	// Imports wait for a Root folder that is not there, so the defaults exist.
	mkdirs(t, data+"/media/movies", data+"/media/tv")
	idx, sab, prober := ixfake.New("ik"), dcfake.New("sk"), &stubProber{}
	reg := plugin.NewRegistry()
	if err := reg.Register(indexer.Contract, idx); err != nil {
		t.Fatal(err)
	}
	if err := reg.Register(downloadclient.Contract, sab); err != nil {
		t.Fatal(err)
	}
	with = append([]func(*app.Options){func(o *app.Options) {
		o.DataDir, o.ConfigDir, o.Plugins, o.Prober = data, config, reg, prober
		o.Metadata = metadata.NewTMDB(metadata.TMDBOptions{BaseURL: tmdb.APIBase(), ImageBase: tmdb.ImageBase(), Keys: metadata.StaticKey(metadatatest.Key)})
		o.Posters = metadata.NewPosters(metadata.PostersOptions{ConfigDir: config, ImageBase: tmdb.ImageBase()})
	}}, with...)
	in := newInstance(t, "", with...)
	b := in.setUp()
	s := search{library: library{browser: b, tmdb: tmdb, config: config, data: data}, idx: idx, sab: sab, prober: prober}

	if r := b.valid("POST", "/plugin-instances", `{"plugin_id":"fake_indexer","name":"Alpha","config":{"api_key":"ik"}}`); r.Status != 201 {
		t.Fatalf("indexer = %d %s", r.Status, r.Body)
	}
	if r := b.valid("POST", "/plugin-instances", `{"plugin_id":"fake","name":"SABnzbd","config":{"api_key":"sk","movie_category":"films"}}`); r.Status != 201 {
		t.Fatalf("client = %d %s", r.Status, r.Body)
	}
	return s
}

// addPaddington adds the Movie in HD and UHD through the API, as the UI does.
func (s *search) addPaddington(t *testing.T) {
	t.Helper()
	r := s.valid("POST", "/titles", addPaddington)
	if r.Status != 201 {
		t.Fatalf("POST /titles = %d %s", r.Status, r.Body)
	}
	created := decode[titleJSON](t, r)
	s.title = created.ID
	for _, v := range created.Versions {
		switch v.Slot {
		case "standard":
			s.hd = v.ID
		case "4k":
			s.uhd = v.ID
		}
	}
}

func (s search) publish(t *testing.T, name string) {
	t.Helper()
	err := s.idx.Publish(indexer.Release{
		Title: name, IMDBID: "tt1109624", TMDBID: 116149, Size: 8 << 30, PublishDate: time.Now().Add(-time.Hour), Categories: []int{2040},
	}, []byte("<nzb>"+name+"</nzb>"))
	if err != nil {
		t.Fatal(err)
	}
}

func (s search) releases(t *testing.T, version int64) releaseListJSON {
	t.Helper()
	r := s.valid("POST", fmt.Sprintf("/versions/%d/releases", version), "")
	if r.Status != 200 {
		t.Fatalf("search = %d %s", r.Status, r.Body)
	}
	return decode[releaseListJSON](t, r)
}

func (l releaseListJSON) find(t *testing.T, name string) releaseJSON {
	t.Helper()
	for _, r := range l.Items {
		if r.Name == name {
			return r
		}
	}
	t.Fatalf("no %q among %d releases", name, len(l.Items))
	return releaseJSON{}
}

func (s search) grab(version int64, release string, override bool) reply {
	return s.valid("POST", "/grabs", fmt.Sprintf(`{"version_id":%d,"release_id":%q,"override":%v}`, version, release, override))
}

const (
	goodRelease  = "Paddington.2014.1080p.BluRay.x264-GRP"
	uhdRelease   = "Paddington.2014.2160p.WEB-DL.x265-GRP"
	frenchBluray = "Paddington.2014.FRENCH.1080p.BluRay.x264-GRP"
)

func TestAManualSearchListsEveryReleaseAndGrabbingOneSendsItToTheDownloadClient(t *testing.T) {
	s := newSearch(t)
	s.publish(t, goodRelease)
	s.publish(t, uhdRelease)

	list := s.releases(t, s.hd)

	if len(list.Items) != 2 || len(list.IndexerErrors) != 0 {
		t.Fatalf("list = %+v", list)
	}
	good := list.find(t, goodRelease)
	if good.Indexer != "Alpha" || good.Quality != "Bluray-1080p" || good.Fits != "this_slot" || len(good.Rejections) != 0 || good.ReleaseID == "" || good.Size != 8<<30 {
		t.Errorf("release = %+v", good)
	}
	if list.Items[0].Name != goodRelease {
		t.Errorf("first = %q, want the acceptable release first", list.Items[0].Name)
	}

	r := s.grab(s.hd, good.ReleaseID, false)
	if r.Status != 201 {
		t.Fatalf("POST /grabs = %d %s", r.Status, r.Body)
	}
	g := decode[grabJSON](t, r)
	if g.State != "sent" || g.ReleaseName != goodRelease || g.Indexer != "Alpha" || g.ClientID == "" || g.Overridden || g.VersionID == nil || *g.VersionID != s.hd {
		t.Errorf("grab = %+v", g)
	}
	jobs, _ := s.sab.List(t.Context(), s.sab.Conn(0), "films")
	if len(jobs) != 1 || jobs[0].ClientID != g.ClientID || jobs[0].Name != goodRelease {
		t.Errorf("download client holds %+v, want the grabbed release in the Movie category", jobs)
	}
	if got := decode[grabJSON](t, s.valid("GET", fmt.Sprintf("/grabs/%d", g.ID), "")); got.ClientID != g.ClientID {
		t.Errorf("GET /grabs/%d = %+v", g.ID, got)
	}
}

func TestGrabAnywayWorksForOverridableRejectionsAndIsRefusedForOtherSlotAndBlocklisted(t *testing.T) {
	s := newSearch(t)
	s.publish(t, frenchBluray)
	s.publish(t, uhdRelease)
	list := s.releases(t, s.hd)

	french := list.find(t, frenchBluray)
	if len(french.Rejections) == 0 || french.Rejections[0].Code != "language" || !french.Rejections[0].Overridable || french.Rejections[0].Message == "" {
		t.Fatalf("rejections = %+v", french.Rejections)
	}
	r := s.grab(s.hd, french.ReleaseID, false)
	if r.Status != 422 || decode[problemJSON](t, r).Code != "rejected" {
		t.Errorf("grab without override = %d %s, want 422 rejected", r.Status, r.Body)
	}
	r = s.grab(s.hd, french.ReleaseID, true)
	if r.Status != 201 || !decode[grabJSON](t, r).Overridden {
		t.Errorf("Grab anyway = %d %s", r.Status, r.Body)
	}

	other := list.find(t, uhdRelease)
	if other.Fits != "other_slot" || len(other.Rejections) != 1 || other.Rejections[0].Code != "other_slot" || other.Rejections[0].Overridable {
		t.Fatalf("2160p for the HD Version = %+v", other)
	}
	for _, override := range []bool{false, true} {
		r = s.grab(s.hd, other.ReleaseID, override)
		if r.Status != 422 || decode[problemJSON](t, r).Code != "not_overridable" {
			t.Errorf("other_slot with override=%v = %d %s, want 422 not_overridable", override, r.Status, r.Body)
		}
	}
	// The same Release is fine for the UHD Version.
	if r = s.grab(s.uhd, other.ReleaseID, false); r.Status != 201 {
		t.Errorf("grab for the UHD Version = %d %s", r.Status, r.Body)
	}
}

func TestAReleaseOnTheBlocklistIsRejectedAndNeverGrabbable(t *testing.T) {
	s := newSearch(t)
	s.publish(t, goodRelease)
	// Nothing adds Blocklist entries yet (failures do, later), so put one in the table by hand.
	if _, err := s.in.st.Write().Exec(
		`INSERT INTO blocklist (release_name, indexer_id, guid, published_at, size, reason, created_at)
		 VALUES (?, 1, 'fake-guid-1', '2000-01-01T00:00:00Z', 0, 'failed', '2026-10-17T12:00:00Z')`, goodRelease); err != nil {
		t.Fatal(err)
	}

	blocked := s.releases(t, s.hd).find(t, goodRelease)

	if len(blocked.Rejections) != 1 || blocked.Rejections[0].Code != "blocklisted" || blocked.Rejections[0].Overridable {
		t.Fatalf("rejections = %+v, want blocklisted, not overridable", blocked.Rejections)
	}
	for _, override := range []bool{false, true} {
		r := s.grab(s.hd, blocked.ReleaseID, override)
		if r.Status != 422 || decode[problemJSON](t, r).Code != "not_overridable" {
			t.Errorf("override=%v: %d %s, want 422 not_overridable", override, r.Status, r.Body)
		}
	}
}

func TestAGrabNeedsAFreshReleaseAndKnownVersion(t *testing.T) {
	s := newSearch(t)
	s.publish(t, goodRelease)
	s.releases(t, s.hd)

	r := s.grab(s.hd, "not-a-release", false)
	if r.Status != 409 || decode[problemJSON](t, r).Code != "release_expired" {
		t.Errorf("unknown release = %d %s, want 409 release_expired", r.Status, r.Body)
	}
	if r = s.valid("POST", "/versions/999/releases", ""); r.Status != 404 {
		t.Errorf("search of an unknown Version = %d", r.Status)
	}
}

func TestAnIndexerThatCannotAnswerIsReportedNextToTheOthersResults(t *testing.T) {
	s := newSearch(t)
	s.publish(t, goodRelease)
	s.idx.Exhaust(plugin.LimitSearch, 90*time.Second)

	list := s.releases(t, s.hd)

	if len(list.Items) != 0 || len(list.IndexerErrors) != 1 {
		t.Fatalf("list = %+v", list)
	}
	e := list.IndexerErrors[0]
	if e.Indexer != "Alpha" || e.Code != "rate_limited" || e.RetryAfter == nil || *e.RetryAfter != 90 {
		t.Errorf("indexer error = %+v", e)
	}
}

func TestSearchAndGrabNeedALogin(t *testing.T) {
	s := newSearch(t)
	anon := s.in.browser()
	for _, p := range []struct{ method, path string }{{"POST", "/versions/1/releases"}, {"POST", "/grabs"}, {"GET", "/grabs/1"}} {
		if r := anon.do(p.method, p.path, "{}"); r.Status != 401 {
			t.Errorf("%s %s = %d, want 401", p.method, p.path, r.Status)
		}
	}
}
