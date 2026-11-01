package api_test

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
	"time"
)

// fakeLiveSAB is fakeSAB plus a queue: one job downloading, two waiting, 1.5 TB free.
func fakeLiveSAB(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		switch {
		case q.Get("mode") == "version":
			_, _ = w.Write([]byte(`{"version": "4.5.1"}`))
		case q.Get("apikey") != sabKey:
			_, _ = w.Write([]byte(`{"status": false, "error": "API Key Incorrect"}`))
		case q.Get("mode") == "get_config":
			_, _ = w.Write([]byte(`{"config": {"categories": [{"name": "movies"}]}}`))
		case q.Get("mode") == "queue":
			_, _ = w.Write([]byte(`{"queue": {"diskspace1": "1536.00", "diskspace1_norm": "1.5 T", "slots": [
				{"nzo_id": "a", "status": "Downloading"}, {"nzo_id": "b", "status": "Queued"}, {"nzo_id": "c", "status": "Paused"}]}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

type liveJSON struct {
	DownloadClient *struct {
		InstanceID  int64     `json:"instance_id"`
		Name        string    `json:"name"`
		State       string    `json:"state"`
		Message     *string   `json:"message"`
		Version     *string   `json:"version"`
		CheckedAt   time.Time `json:"checked_at"`
		Downloading *int      `json:"downloading"`
		Queued      *int      `json:"queued"`
		FreeBytes   *int64    `json:"free_bytes"`
	} `json:"download_client"`
	Indexers []struct {
		InstanceID int64 `json:"instance_id"`
		Grabs30d   int   `json:"grabs_30d"`
	} `json:"indexers"`
}

func TestDownloadsStatusReportsTheLiveClientAndCountsEachIndexersRecentGrabs(t *testing.T) {
	t.Parallel()
	sab, idx := fakeLiveSAB(t), fakeIndexer(t)
	in := newInstance(t, "", withSABAndNewznab(t))
	b := in.setUp()

	if got := decode[liveJSON](t, b.valid("GET", "/settings/downloads", "")); got.DownloadClient != nil || len(got.Indexers) != 0 {
		t.Fatalf("nothing configured: %+v", got)
	}

	client := decode[instanceJSON](t, b.valid("POST", "/plugin-instances", sabBody(sab.URL, sabKey, "")))
	busy := decode[instanceJSON](t, b.valid("POST", "/plugin-instances", newznabBody("Busy", idx.URL, nzbKey, "")))
	quiet := decode[instanceJSON](t, b.valid("POST", "/plugin-instances", newznabBody("Quiet", idx.URL, nzbKey, "")))
	off := decode[instanceJSON](t, b.valid("POST", "/plugin-instances", strings.Replace(newznabBody("Off", idx.URL, nzbKey, ""), `"name"`, `"enabled":false,"name"`, 1)))

	now := in.clock.Now().UTC()
	grab := func(n int, indexerID int64, at time.Time) {
		ts := at.Format(time.RFC3339)
		if _, err := in.st.Write().Exec(`INSERT INTO grabs (release_guid, release_name, indexer_id, indexer_name, size, published_at, score, parsed, verdict, client_instance_id, client_id, state, created_at, updated_at)
			VALUES (?, 'x', ?, 'i', 1, ?, 0, '{}', '{}', 1, ?, 'imported', ?, ?)`, fmt.Sprint("g", n), indexerID, ts, fmt.Sprint("c", n), ts, ts); err != nil {
			t.Fatal(err)
		}
	}
	grab(1, busy.ID, now.Add(-time.Hour))
	grab(2, busy.ID, now.Add(-29*24*time.Hour))
	grab(3, busy.ID, now.Add(-31*24*time.Hour)) // too old
	grab(4, off.ID, now.Add(-2*time.Hour))      // disabled indexers count too
	grab(5, 9999, now)                          // an indexer that is gone is not listed

	got := decode[liveJSON](t, b.valid("GET", "/settings/downloads", ""))
	c := got.DownloadClient
	if c == nil || c.InstanceID != client.ID || c.Name != "SABnzbd" || c.State != "ok" || c.Message != nil ||
		c.Version == nil || *c.Version != "4.5.1" || c.Downloading == nil || *c.Downloading != 1 || c.Queued == nil || *c.Queued != 2 ||
		c.FreeBytes == nil || *c.FreeBytes != int64(1.5*(1<<40)) || !c.CheckedAt.Equal(now) {
		t.Fatalf("client: %+v", c)
	}
	counts := map[int64]int{}
	for _, i := range got.Indexers {
		counts[i.InstanceID] = i.Grabs30d
	}
	if len(counts) != 3 || counts[busy.ID] != 2 || counts[quiet.ID] != 0 || counts[off.ID] != 1 {
		t.Fatalf("indexers: %+v", got.Indexers)
	}
	ids := []int64{}
	for _, i := range got.Indexers {
		ids = append(ids, i.InstanceID)
	}
	if !sort.SliceIsSorted(ids, func(i, j int) bool { return ids[i] < ids[j] }) {
		t.Errorf("indexers come in instance order: %v", ids)
	}

	// The call counts as a check of the client: it is on the instance now.
	lc := decode[lastCheckJSON](t, b.valid("GET", "/plugin-instances/"+itoa(client.ID), "")).LastCheck
	if lc == nil || !lc.OK {
		t.Fatalf("a good status is a good check: %+v", lc)
	}
}

func TestDownloadsStatusSaysWhyAClientFails(t *testing.T) {
	t.Parallel()
	sab := fakeLiveSAB(t)
	b := newInstance(t, "", withSABAndNewznab(t)).setUp()
	client := decode[instanceJSON](t, b.valid("POST", "/plugin-instances", sabBody(sab.URL, sabKey, "")))
	b.valid("PATCH", "/plugin-instances/"+itoa(client.ID), `{"config":{"api_key":"revoked"}}`)

	r := b.valid("GET", "/settings/downloads", "")
	if r.Status != 200 {
		t.Fatalf("a failing client is still 200: %d %s", r.Status, r.Body)
	}
	c := decode[liveJSON](t, r).DownloadClient
	if c == nil || c.State != "failing" || c.Message == nil || *c.Message == "" ||
		c.Version != nil || c.Downloading != nil || c.Queued != nil || c.FreeBytes != nil {
		t.Fatalf("failing client: %+v", c)
	}
}

func TestPluginTestReportsLatencyAndVersionAndKeepsTheSavedOne(t *testing.T) {
	t.Parallel()
	sab := fakeSAB(t)
	b := newInstance(t, "", withSAB(t)).setUp()

	type result struct {
		OK        bool    `json:"ok"`
		LatencyMs *int64  `json:"latency_ms"`
		Version   *string `json:"version"`
	}
	// A test of a form is measured and reported, and stores nothing.
	form := decode[result](t, b.valid("POST", "/plugin-instances/test", `{"plugin_id":"sabnzbd","config":{"url":"`+sab.URL+`","api_key":"`+sabKey+`"}}`))
	if !form.OK || form.LatencyMs == nil || *form.LatencyMs <= 0 || form.Version == nil || *form.Version != "4.5.1" {
		t.Fatalf("form test: %+v", form)
	}
	created := decode[instanceJSON](t, b.valid("POST", "/plugin-instances", sabBody(sab.URL, sabKey, "")))
	id := "/plugin-instances/" + itoa(created.ID)
	type withLatency struct {
		LastCheck *struct {
			LatencyMs *int64 `json:"latency_ms"`
		} `json:"last_check"`
	}
	if got := decode[withLatency](t, b.valid("GET", id, "")); got.LastCheck != nil {
		t.Fatalf("no latency before a test: %+v", got.LastCheck)
	}

	saved := decode[result](t, b.valid("POST", id+"/test", ""))
	if !saved.OK || saved.LatencyMs == nil || *saved.LatencyMs <= 0 {
		t.Fatalf("saved test: %+v", saved)
	}
	got := decode[withLatency](t, b.valid("GET", id, ""))
	// The instance keeps a measured latency. It need not equal the reported one: the
	// health checks test the same instance in the background and the latest check wins.
	if got.LastCheck == nil || got.LastCheck.LatencyMs == nil || *got.LastCheck.LatencyMs <= 0 {
		t.Fatalf("the saved test's latency is on the instance: %+v", got.LastCheck)
	}

	// A failed test still reports how long it took, and leaves the saved latency alone.
	b.valid("PATCH", id, `{"config":{"api_key":"revoked"}}`)
	failed := decode[result](t, b.valid("POST", id+"/test", ""))
	if failed.OK || failed.LatencyMs == nil {
		t.Fatalf("failed test: %+v", failed)
	}
	if got = decode[withLatency](t, b.valid("GET", id, "")); got.LastCheck.LatencyMs == nil || *got.LastCheck.LatencyMs <= 0 {
		t.Fatalf("after a failed test: %+v", got.LastCheck)
	}
}

type profileDetailJSON struct {
	Key    string      `json:"key"`
	Titles int         `json:"titles"`
	Files  int         `json:"files"`
	Movies scoringJSON `json:"movies"`
	Series scoringJSON `json:"series"`
}

type scoringJSON struct {
	Qualities     []string `json:"qualities"`
	MinScore      int      `json:"min_score"`
	CustomFormats []struct {
		Name  string `json:"name"`
		Score int    `json:"score"`
	} `json:"custom_formats"`
}

func TestProfileDetailsCountTitlesAndFilesAndListWhatTheSnapshotScores(t *testing.T) {
	t.Parallel()
	w := newWantedRig(t)
	decode[titleJSON](t, w.valid("POST", "/titles", fmt.Sprintf(addHD, 116149)))
	decode[titleJSON](t, w.valid("POST", "/titles", fmt.Sprintf(addHD, 77)))
	w.exec(t, `INSERT INTO files (version_id, path, size, release_name, imported_at) SELECT id, 'x.mkv', 1, 'x', '2026-10-01T00:00:00Z' FROM versions WHERE title_id = (SELECT MIN(title_id) FROM versions)`)

	profiles := decode[struct {
		Items []profileJSON `json:"items"`
	}](t, w.valid("GET", "/profiles", "")).Items
	list := decode[struct {
		Items []profileDetailJSON `json:"items"`
	}](t, w.valid("GET", "/profiles/details", "")).Items
	if len(list) != len(profiles) {
		t.Fatalf("%d details for %d Profiles", len(list), len(profiles))
	}
	for i, d := range list {
		if d.Key != profiles[i].Key {
			t.Fatalf("detail %d is %q, want %q (the order of /profiles)", i, d.Key, profiles[i].Key)
		}
		want := [2]int{}
		if d.Key == "hd-primary" {
			want = [2]int{2, 1}
		}
		if [2]int{d.Titles, d.Files} != want {
			t.Errorf("%s: titles/files = %d/%d, want %v", d.Key, d.Titles, d.Files, want)
		}
		for _, k := range []scoringJSON{d.Movies, d.Series} {
			if k.Qualities == nil || k.CustomFormats == nil {
				t.Errorf("%s: arrays must not be null: %+v", d.Key, k)
			}
		}
	}
	hd := list[0]
	if hd.Key != "hd-primary" || len(hd.Movies.Qualities) == 0 || len(hd.Movies.CustomFormats) == 0 {
		t.Fatalf("hd-primary should score under the embedded snapshot: %+v", hd)
	}
	cf := hd.Movies.CustomFormats
	if !sort.SliceIsSorted(cf, func(i, j int) bool {
		return cf[i].Score > cf[j].Score || cf[i].Score == cf[j].Score && cf[i].Name < cf[j].Name
	}) {
		t.Errorf("custom formats are not highest score first, then by name: %+v", cf)
	}
}
