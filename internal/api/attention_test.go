package api_test

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/app"
	"github.com/hyprsh/kestrel/internal/health"
	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
	"github.com/hyprsh/kestrel/internal/settings"
)

type actionJSON struct {
	Key     string         `json:"key"`
	Label   string         `json:"label"`
	Method  string         `json:"method"`
	Path    string         `json:"path"`
	Body    map[string]any `json:"body"`
	Confirm *string        `json:"confirm"`
}

type attentionRowJSON struct {
	ID       string `json:"id"`
	Severity string `json:"severity"`
	Kind     string `json:"kind"`
	Message  string `json:"message"`
	Count    int    `json:"count"`
	Subject  struct {
		PluginInstanceID *int64 `json:"plugin_instance_id"`
		GrabID           *int64 `json:"grab_id"`
	} `json:"subject"`
	Actions []actionJSON `json:"actions"`
}

type attentionJSON struct {
	Count       int                `json:"count"`
	Severity    *string            `json:"severity"`
	Rows        []attentionRowJSON `json:"rows"`
	LongMissing struct {
		Count int   `json:"count"`
		Items []any `json:"items"`
	} `json:"long_missing"`
}

func (a attentionJSON) kinds() []string {
	out := make([]string, 0, len(a.Rows))
	for _, r := range a.Rows {
		out = append(out, r.Kind)
	}
	return out
}

func (a attentionJSON) row(t *testing.T, kind string) attentionRowJSON {
	t.Helper()
	for _, r := range a.Rows {
		if r.Kind == kind {
			return r
		}
	}
	t.Fatalf("no %s row among %v", kind, a.kinds())
	return attentionRowJSON{}
}

func (a attentionJSON) has(kind string) bool {
	for _, r := range a.Rows {
		if r.Kind == kind {
			return true
		}
	}
	return false
}

func (r attentionRowJSON) action(t *testing.T, key string) actionJSON {
	t.Helper()
	for _, a := range r.Actions {
		if a.Key == key {
			return a
		}
	}
	t.Fatalf("row %s has no %q action: %+v", r.Kind, key, r.Actions)
	return actionJSON{}
}

func (b *browser) attention(t *testing.T) attentionJSON {
	t.Helper()
	r := b.valid("GET", "/attention", "")
	if r.Status != 200 {
		t.Fatalf("GET /attention = %d %s", r.Status, r.Body)
	}
	return decode[attentionJSON](t, r)
}

// instanceID is the id of the (only) instance of a plugin.
func (b *browser) instanceID(t *testing.T, pluginID string) int64 {
	t.Helper()
	list := decode[struct {
		Items []instanceJSON `json:"items"`
	}](t, b.valid("GET", "/plugin-instances", ""))
	for _, i := range list.Items {
		if i.PluginID == pluginID {
			return i.ID
		}
	}
	t.Fatalf("no %s instance", pluginID)
	return 0
}

func (b *browser) setKey(t *testing.T, id int64, key string) {
	t.Helper()
	if r := b.valid("PATCH", fmt.Sprintf("/plugin-instances/%d", id), fmt.Sprintf(`{"config":{"api_key":%q}}`, key)); r.Status != 200 {
		t.Fatalf("PATCH instance = %d %s", r.Status, r.Body)
	}
}

func (s search) checks(t *testing.T) { t.Helper(); s.pass(t, jobs.Health) }

func (s search) finishSetup(t *testing.T) {
	t.Helper()
	if err := settings.New(s.in.st).Put(context.Background(), "setup_completed", []byte("true")); err != nil {
		t.Fatal(err)
	}
}

func TestABlockingRowAppearsWhenSABnzbdFailsAndClearsWhenItRecovers(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	sab := s.instanceID(t, "fake")
	if n := s.attention(t).Count; n != 0 {
		t.Fatalf("a healthy instance has %d rows", n)
	}

	s.setKey(t, sab, "rejected")
	s.checks(t)
	if n := s.attention(t).Count; n != 0 {
		t.Fatalf("one failed check is not two minutes of failing: %d rows", n)
	}
	s.in.clock.Advance(3 * time.Minute)
	s.checks(t)

	a := s.attention(t)
	if a.Count != 1 || a.Severity == nil || *a.Severity != "blocking" {
		t.Fatalf("attention = %+v", a)
	}
	row := a.row(t, "download_client_unreachable")
	if row.Severity != "blocking" || row.Subject.PluginInstanceID == nil || *row.Subject.PluginInstanceID != sab || !strings.Contains(row.Message, "SABnzbd") {
		t.Errorf("row = %+v", row)
	}
	if test := row.action(t, "test"); test.Method != "POST" || test.Path != fmt.Sprintf("/plugin-instances/%d/test", sab) {
		t.Errorf("test action = %+v", test)
	}
	if open := row.action(t, "open"); open.Method != "GET" || open.Path != "/settings/download-client" {
		t.Errorf("open action = %+v", open)
	}

	s.setKey(t, sab, "sk")
	s.checks(t)
	if a := s.attention(t); a.Count != 0 || a.Severity != nil {
		t.Errorf("after recovery: %+v", a)
	}
}

func TestFailedPollsOfARunningDownloadAlsoRaiseTheSABnzbdRow(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.publish(t, goodRelease)
	s.pass(t, jobs.Search)
	s.setKey(t, s.instanceID(t, "fake"), "rejected")

	_ = s.in.app.Jobs.Pass(context.Background(), jobs.Poll)
	s.in.clock.Advance(3 * time.Minute)
	_ = s.in.app.Jobs.Pass(context.Background(), jobs.Poll)

	if !s.attention(t).has("download_client_unreachable") {
		t.Errorf("rows = %v", s.attention(t).kinds())
	}
}

func TestNoIndexerCanSearchIsBlockingOnceSetupIsDoneAndClearsWithAnEnabledIndexer(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	idx := s.instanceID(t, "fake_indexer")
	path := fmt.Sprintf("/plugin-instances/%d", idx)

	s.checks(t)
	if s.attention(t).has("no_indexer") {
		t.Fatal("the wizard has not finished; there is nothing to flag yet")
	}
	s.finishSetup(t)
	if r := s.valid("PATCH", path, `{"enabled":false}`); r.Status != 200 {
		t.Fatalf("disable = %d %s", r.Status, r.Body)
	}
	s.checks(t)

	row := s.attention(t).row(t, "no_indexer")
	if row.Severity != "blocking" {
		t.Errorf("row = %+v", row)
	}
	if open := row.action(t, "open"); open.Path != "/settings/indexers" {
		t.Errorf("open action = %+v", open)
	}

	if r := s.valid("PATCH", path, `{"enabled":true}`); r.Status != 200 {
		t.Fatalf("enable = %d %s", r.Status, r.Body)
	}
	s.checks(t)
	if s.attention(t).has("no_indexer") {
		t.Error("an enabled indexer should clear it")
	}
}

func TestAnIndexerWithBadCredentialsIsAWarningWithTestOpenAndDisableAndBlockingRowsSortFirst(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.finishSetup(t)
	idx := s.instanceID(t, "fake_indexer")

	s.setKey(t, idx, "rejected")
	s.releases(t, s.hd)

	a := s.attention(t)
	if got := a.kinds(); len(got) != 2 || got[0] != "no_indexer" || got[1] != "indexer_failing" {
		t.Fatalf("rows = %v, want the Blocking one first", got)
	}
	if a.Count != 2 || a.Severity == nil || *a.Severity != "blocking" {
		t.Errorf("count/severity = %d %v", a.Count, a.Severity)
	}
	row := a.row(t, "indexer_failing")
	if row.Severity != "warning" || !strings.Contains(row.Message, "Alpha") {
		t.Errorf("row = %+v", row)
	}
	row.action(t, "test")
	row.action(t, "open")
	dis := row.action(t, "disable")
	if dis.Method != "PATCH" || dis.Path != fmt.Sprintf("/plugin-instances/%d", idx) || dis.Body["enabled"] != false {
		t.Errorf("disable action = %+v", dis)
	}

	s.setKey(t, idx, "ik")
	s.releases(t, s.hd)
	if a := s.attention(t); a.Count != 0 {
		t.Errorf("after recovery: %v", a.kinds())
	}
}

func TestADeclaredIndexerWithBadCredentialsOffersNoDisable(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	s.finishSetup(t)
	alpha := "plugin_instances:\n  - name: Alpha\n    plugin_id: fake_indexer\n    config:\n      api_key_env: INDEXER_KEY\n"
	s.in.mustDeclare(alpha, "INDEXER_KEY", "rejected")
	s.releases(t, s.hd)

	row := s.attention(t).row(t, "indexer_failing")
	row.action(t, "test")
	row.action(t, "open")
	for _, a := range row.Actions {
		if a.Key == "disable" {
			t.Errorf("a declared indexer offers %+v, which the API refuses", a)
		}
	}
}

func TestRootFolderUnavailableIsBlockingForAMissingFolderAndClearsWhenItIsBack(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	s.finishSetup(t)
	movies, tv := s.data+"/media/movies", s.data+"/media/tv"
	mkdirs(t, movies, tv)
	if r := s.valid("PATCH", "/settings", fmt.Sprintf(`{"root_folders":{"movies":[%q],"series":[%q]}}`, movies, tv)); r.Status != 200 {
		t.Fatalf("PATCH /settings = %d %s", r.Status, r.Body)
	}
	s.checks(t)
	if s.attention(t).has("root_folder_unavailable") {
		t.Fatalf("rows = %v", s.attention(t).kinds())
	}

	if err := os.RemoveAll(movies); err != nil {
		t.Fatal(err)
	}
	s.checks(t)
	row := s.attention(t).row(t, "root_folder_unavailable")
	if row.Severity != "blocking" || !strings.Contains(row.Message, movies) {
		t.Errorf("row = %+v", row)
	}
	if open := row.action(t, "open"); open.Path != "/settings/root-folders" {
		t.Errorf("open action = %+v", open)
	}

	mkdirs(t, movies)
	s.checks(t)
	if s.attention(t).has("root_folder_unavailable") {
		t.Error("the folder is back, so the row should clear")
	}
}

func lowDisk(o *app.Options) {
	o.DiskSpace = func(string) (health.Space, error) { return health.Space{Free: 10 << 30, Total: 1 << 40}, nil }
}

func TestLowDiskSpaceIsAWarningAndTheHealthStripShowsFreeSpace(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t, lowDisk)
	s.checks(t)

	row := s.attention(t).row(t, "low_disk_space")
	if row.Severity != "warning" || len(row.Actions) != 0 {
		t.Errorf("row = %+v", row)
	}

	st := decode[statusJSON](t, s.valid("GET", "/system/status", ""))
	if len(st.Disks) < 1 || st.Disks[0].Path != s.data || st.Disks[0].FreeBytes != 10<<30 || st.Disks[0].TotalBytes != 1<<40 {
		t.Errorf("disks = %+v", st.Disks)
	}
}

type statusJSON struct {
	DownloadClient struct {
		State      string  `json:"state"`
		Name       *string `json:"name"`
		InstanceID *int64  `json:"instance_id"`
		Message    *string `json:"message"`
	} `json:"download_client"`
	Indexers []struct {
		InstanceID int64   `json:"instance_id"`
		Name       string  `json:"name"`
		State      string  `json:"state"`
		Message    *string `json:"message"`
	} `json:"indexers"`
	Disks []struct {
		Path       string `json:"path"`
		FreeBytes  int64  `json:"free_bytes"`
		TotalBytes int64  `json:"total_bytes"`
	} `json:"disks"`
}

func TestTheHealthStripShowsTheDownloadClientAndEachIndexersState(t *testing.T) {
	t.Parallel()
	s := newSearch(t)

	st := decode[statusJSON](t, s.valid("GET", "/system/status", ""))
	if st.DownloadClient.State != "ok" || st.DownloadClient.Name == nil || *st.DownloadClient.Name != "SABnzbd" {
		t.Errorf("download client = %+v", st.DownloadClient)
	}
	if len(st.Indexers) != 1 || st.Indexers[0].Name != "Alpha" || st.Indexers[0].State != "ok" {
		t.Errorf("indexers = %+v", st.Indexers)
	}

	idx := s.instanceID(t, "fake_indexer")
	s.setKey(t, idx, "rejected")
	s.releases(t, s.hd)
	s.setKey(t, s.instanceID(t, "fake"), "rejected")
	_ = s.in.app.Jobs.Pass(context.Background(), jobs.Health)

	st = decode[statusJSON](t, s.valid("GET", "/system/status", ""))
	if st.Indexers[0].State != "failing" || st.Indexers[0].Message == nil {
		t.Errorf("indexer = %+v", st.Indexers[0])
	}
	if st.DownloadClient.State != "failing" || st.DownloadClient.Message == nil {
		t.Errorf("download client = %+v", st.DownloadClient)
	}

	if r := s.valid("PATCH", fmt.Sprintf("/plugin-instances/%d", idx), `{"enabled":false}`); r.Status != 200 {
		t.Fatalf("disable = %d", r.Status)
	}
	st = decode[statusJSON](t, s.valid("GET", "/system/status", ""))
	if st.Indexers[0].State != "disabled" {
		t.Errorf("a disabled indexer = %+v", st.Indexers[0])
	}
}

func TestAnUntrustedProxyHeaderThatKeepsComingIsAWarningUntilTheAddressIsTrusted(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	b := in.setUp()
	enableProxy(t, b, "10.0.0.0/8")
	check := func() {
		t.Helper()
		if err := in.app.Jobs.Pass(context.Background(), jobs.Health); err != nil {
			t.Fatal(err)
		}
	}

	in.call("GET", "/auth/me", "", map[string]string{"Remote-User": "mallory"})
	check()
	if b.attention(t).has("untrusted_proxy_header") {
		t.Fatal("a single stray header is not a pattern yet")
	}
	in.call("GET", "/auth/me", "", map[string]string{"Remote-User": "mallory"})
	check()

	row := b.attention(t).row(t, "untrusted_proxy_header")
	if row.Severity != "warning" || !strings.Contains(row.Message, "Proxy header received from an untrusted address") {
		t.Errorf("row = %+v", row)
	}
	if open := row.action(t, "open"); open.Path != "/settings/security" {
		t.Errorf("open action = %+v", open)
	}

	enableProxy(t, b, "127.0.0.1")
	check()
	if b.attention(t).has("untrusted_proxy_header") {
		t.Error("the sender is trusted now, so the row should clear")
	}
}

func TestOnlyOneOffHealthWarningsCanBeDismissedAndTheyReturnWhenTheyRecur(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	s := newSearchBare(t)
	h := s.in.app.Health
	exdev := health.Issue{
		Key: "exdev:/data/media/movies", Kind: health.KindEXDEV, Severity: health.Warning, Dismissible: true,
		Message: "Importing into /data/media/movies copies instead of moving",
	}
	if err := h.Raise(ctx, exdev); err != nil {
		t.Fatal(err)
	}

	row := s.attention(t).row(t, "exdev")
	dismiss := row.action(t, "dismiss")
	if dismiss.Method != "POST" || dismiss.Path != "/attention/"+row.ID+"/dismiss" {
		t.Fatalf("dismiss action = %+v", dismiss)
	}
	if r := s.valid("POST", dismiss.Path, ""); r.Status != 204 {
		t.Fatalf("dismiss = %d %s", r.Status, r.Body)
	}
	if n := s.attention(t).Count; n != 0 {
		t.Fatalf("a dismissed row still counts: %d", n)
	}
	_ = h.Raise(ctx, exdev)
	if got := s.attention(t).row(t, "exdev"); got.Count != 2 {
		t.Errorf("recurring row = %+v", got)
	}

	_ = h.Raise(ctx, health.Issue{Key: "stuck", Kind: health.KindLowDisk, Severity: health.Warning, Message: "x"})
	stuck := s.attention(t).row(t, "low_disk_space")
	for _, a := range stuck.Actions {
		if a.Key == "dismiss" {
			t.Errorf("a condition row offers dismiss: %+v", stuck.Actions)
		}
	}
	if r := s.valid("POST", "/attention/"+stuck.ID+"/dismiss", ""); r.Status != 409 {
		t.Errorf("dismissing a condition = %d, want 409", r.Status)
	}
	if r := s.valid("POST", "/attention/health-9999/dismiss", ""); r.Status != 404 {
		t.Errorf("dismissing an unknown row = %d, want 404", r.Status)
	}
	if r := s.valid("POST", "/attention/nonsense/dismiss", ""); r.Status != 404 {
		t.Errorf("dismissing a malformed id = %d, want 404", r.Status)
	}
}

func TestWarningsSortNewestFirstAfterEveryBlockingRow(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	s := newSearchBare(t)
	h := s.in.app.Health
	raise := func(key string, sev health.Severity) {
		t.Helper()
		if err := h.Raise(ctx, health.Issue{Key: key, Kind: health.KindEXDEV, Severity: sev, Message: key}); err != nil {
			t.Fatal(err)
		}
		s.in.clock.Advance(time.Minute)
	}
	raise("old-warning", health.Warning)
	raise("blocking", health.Blocking)
	raise("new-warning", health.Warning)

	var got []string
	for _, r := range s.attention(t).Rows {
		got = append(got, r.Message)
	}
	if want := "blocking,new-warning,old-warning"; strings.Join(got, ",") != want {
		t.Errorf("order = %v, want %s", got, want)
	}
}

func TestTheStreamCarriesTheAttentionCountAndSeverityAsRowsComeAndGo(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	s := newSearchBare(t, fastStream)
	st := s.stream(t)
	attentionFrame := func(name string, ok func(count int, severity *string) bool) {
		t.Helper()
		st.until(name, func(e sseEvent) bool {
			if e.Name != "attention" {
				return false
			}
			var f struct {
				Count    int     `json:"count"`
				Severity *string `json:"severity"`
			}
			return json.Unmarshal([]byte(e.Data), &f) == nil && ok(f.Count, f.Severity)
		})
	}
	attentionFrame("none", func(n int, sev *string) bool { return n == 0 && sev == nil })

	st.mark()
	h := s.in.app.Health
	_ = h.Raise(ctx, health.Issue{Key: "k", Kind: health.KindLowDisk, Severity: health.Blocking, Message: "full"})
	attentionFrame("one blocking", func(n int, sev *string) bool { return n == 1 && sev != nil && *sev == "blocking" })
	st.hint("attention")

	st.mark()
	_ = h.Clear(ctx, "k")
	attentionFrame("none again", func(n int, sev *string) bool { return n == 0 && sev == nil })
}

func TestTheMetadataProviderRejectingItsKeyIsABlockingRowUntilALookupWorksAgain(t *testing.T) {
	t.Parallel()
	tmdb := metadatatest.New(t)
	key := &swappable{}
	key.set("wrong")
	s := newSearchBare(t, func(o *app.Options) {
		o.Metadata = metadata.NewTMDB(metadata.TMDBOptions{BaseURL: tmdb.APIBase(), ImageBase: tmdb.ImageBase(), Keys: key})
	})

	if r := s.do("GET", "/lookup?q=paddington", ""); r.Status != 502 {
		t.Fatalf("lookup with a rejected key = %d %s", r.Status, r.Body)
	}

	row := s.attention(t).row(t, "metadata_provider_failing")
	if row.Severity != "blocking" || !strings.Contains(row.Message, "TMDB") {
		t.Errorf("row = %+v", row)
	}

	key.set(metadatatest.Key)
	if r := s.valid("GET", "/lookup?q=paddington", ""); r.Status != 200 {
		t.Fatalf("lookup = %d %s", r.Status, r.Body)
	}
	if s.attention(t).has("metadata_provider_failing") {
		t.Error("a working lookup should clear it")
	}
}

// swappable is a key source a test can change under a running instance.
type swappable struct{ v atomic.Value }

func (s *swappable) set(k string) { s.v.Store(k) }

func (s *swappable) TMDB(context.Context) (string, error) { return s.v.Load().(string), nil }
