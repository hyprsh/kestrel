package sabnzbd_test

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/adapters/sabnzbd"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
	"github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1/conformance"
)

const key = "0123456789abcdef0123456789abcdef"

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// call is one request SABnzbd received.
type call struct {
	Method string
	Query  url.Values
	Body   []byte
	Header http.Header
}

// recorded serves the recorded fixtures by mode and remembers every request.
type recorded struct {
	*httptest.Server
	mu    sync.Mutex
	calls []call
}

func serveFixtures(t *testing.T, override map[string]func(http.ResponseWriter, *http.Request)) *recorded {
	t.Helper()
	files := map[string]string{
		"version": "version.json", "get_config": "get_config.json", "addfile": "addfile.json",
	}
	r := &recorded{}
	r.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		body, _ := io.ReadAll(req.Body)
		q := req.URL.Query()
		r.mu.Lock()
		r.calls = append(r.calls, call{req.Method, q, body, req.Header})
		r.mu.Unlock()
		if req.URL.Path != "/sab/api" {
			http.NotFound(w, req)
			return
		}
		mode := q.Get("mode")
		if q.Get("apikey") != key && mode != "version" {
			_, _ = w.Write(fixture(t, "auth_error.json"))
			return
		}
		if f, ok := override[mode]; ok {
			f(w, req)
			return
		}
		switch {
		case mode == "queue" && q.Get("name") == "delete", mode == "history" && q.Get("name") == "delete":
			_, _ = w.Write(fixture(t, "delete.json"))
		case mode == "queue":
			_, _ = w.Write(fixture(t, "queue.json"))
		case mode == "history":
			_, _ = w.Write(fixture(t, "history.json"))
		default:
			_, _ = w.Write(fixture(t, files[mode]))
		}
	}))
	t.Cleanup(r.Close)
	return r
}

func (r *recorded) conn(apiKey string) plugin.Connection {
	return plugin.Connection{ID: 1, Config: map[string]any{"url": r.URL + "/sab/", "api_key": apiKey}}
}

func (r *recorded) last() call {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.calls[len(r.calls)-1]
}

func ctx() context.Context { return context.Background() }

func TestManifestMatchesTheTicket(t *testing.T) {
	m := sabnzbd.New(nil).Describe()
	if m.ID != "sabnzbd" || m.Contract != "download_client.v1" {
		t.Fatalf("%+v", m)
	}
	want := map[string]struct {
		typ plugin.FieldType
		def any
	}{
		"url": {plugin.FieldURL, nil}, "api_key": {plugin.FieldSecret, nil},
		"movie_category": {plugin.FieldText, "movies"}, "tv_category": {plugin.FieldText, "tv"},
	}
	if len(m.Fields) != len(want) {
		t.Fatalf("fields %+v", m.Fields)
	}
	for _, f := range m.Fields {
		w, ok := want[f.Key]
		if !ok || f.Type != w.typ || f.Default != w.def {
			t.Errorf("field %+v", f)
		}
	}
}

func TestListMapsQueueAndHistoryFixtures(t *testing.T) {
	srv := serveFixtures(t, nil)
	items, err := sabnzbd.New(nil).List(ctx(), srv.conn(key), "movies")
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]downloadclient.Item{}
	for _, it := range items {
		got[it.ClientID] = it
	}
	if _, tv := got["SABnzbd_nzo_tv1"]; tv || len(items) != 10 {
		t.Fatalf("category filter: %d items, tv present=%v", len(items), tv)
	}

	check := func(id string, phase downloadclient.Phase, failure downloadclient.Failure) downloadclient.Item {
		t.Helper()
		it, ok := got[id]
		if !ok {
			t.Fatalf("%s not listed", id)
		}
		if it.Phase != phase || it.Failure != failure {
			t.Errorf("%s: phase %q failure %q, want %q %q", id, it.Phase, it.Failure, phase, failure)
		}
		return it
	}
	dl := check("SABnzbd_nzo_dl1", downloadclient.PhaseDownloading, "")
	if dl.BytesTotal != 20480*1024*1024 || dl.BytesLeft != int64(5120.5*1024*1024) || dl.ETA != time.Hour+2*time.Minute+3*time.Second {
		t.Errorf("progress %+v", dl)
	}
	check("SABnzbd_nzo_q1", downloadclient.PhaseQueued, "")
	check("SABnzbd_nzo_p1", downloadclient.PhasePaused, "")
	check("SABnzbd_nzo_pr1", downloadclient.PhaseQueued, "")
	enc := check("SABnzbd_nzo_enc1", downloadclient.PhaseFailed, downloadclient.FailureEncrypted)
	if enc.Name != "Locked.Movie.2021.1080p-GRP" {
		t.Errorf("encrypted prefix not stripped: %q", enc.Name)
	}

	done := check("SABnzbd_nzo_done1", downloadclient.PhaseCompleted, "")
	if done.OutputPath != "/data/usenet/complete/movies/Movie.2023.1080p.WEB-DL-GRP" || !done.CanRemove || done.Name != "Movie.2023.1080p.WEB-DL-GRP" {
		t.Errorf("completed %+v", done)
	}
	check("SABnzbd_nzo_post1", downloadclient.PhasePostProcessing, "")
	bad := check("SABnzbd_nzo_fail1", downloadclient.PhaseFailed, downloadclient.FailureFailed)
	if bad.Message != "Repairing failed, not enough repair blocks (12 short)" {
		t.Errorf("fail_message must be kept verbatim: %q", bad.Message)
	}
	disk := check("SABnzbd_nzo_disk1", downloadclient.PhaseFailed, downloadclient.FailureOther)
	if disk.Message != "Unpacking failed, write error or disk is full?" {
		t.Errorf("message %q", disk.Message)
	}
	check("SABnzbd_nzo_enc2", downloadclient.PhaseFailed, downloadclient.FailureEncrypted)

	q := srv.calls[0].Query
	if q.Get("mode") != "queue" || q.Get("category") != "movies" || q.Get("output") != "json" || q.Get("apikey") != key {
		t.Errorf("queue request %v", q)
	}
}

func TestListWithoutCategoryReturnsEverything(t *testing.T) {
	srv := serveFixtures(t, nil)
	items, err := sabnzbd.New(nil).List(ctx(), srv.conn(key), "")
	if err != nil || len(items) != 12 {
		t.Fatalf("%d items, err %v", len(items), err)
	}
	if srv.calls[0].Query.Has("category") {
		t.Error("no category filter should be sent")
	}
}

func TestAddSendsTheNZBAtPriorityMinus100(t *testing.T) {
	srv := serveFixtures(t, nil)
	id, err := sabnzbd.New(nil).Add(ctx(), srv.conn(key), downloadclient.AddRequest{
		Kind: downloadclient.PayloadNZB, Data: []byte("<nzb/>"), Filename: "Movie: The Sequel (2024) 1080p/WEB", Category: "movies", Priority: 2,
	})
	if err != nil || id != "SABnzbd_nzo_abc123" {
		t.Fatalf("%q %v", id, err)
	}
	c := srv.last()
	if c.Method != http.MethodPost || c.Query.Get("mode") != "addfile" || c.Query.Get("cat") != "movies" || c.Query.Get("priority") != "-100" {
		t.Fatalf("addfile request %s %v", c.Method, c.Query)
	}
	_, params, err := mime.ParseMediaType(c.Header.Get("Content-Type"))
	if err != nil {
		t.Fatal(err)
	}
	body := string(c.Body)
	if !strings.Contains(body, `name="name"; filename="Movie The Sequel (2024) 1080p WEB.nzb"`) || !strings.Contains(body, "<nzb/>") || params["boundary"] == "" {
		t.Fatalf("multipart body %q", body)
	}
}

func TestAddRefusesWhatSABnzbdCannotTake(t *testing.T) {
	srv := serveFixtures(t, nil)
	for _, kind := range []downloadclient.PayloadKind{downloadclient.PayloadTorrent, downloadclient.PayloadMagnet} {
		_, err := sabnzbd.New(nil).Add(ctx(), srv.conn(key), downloadclient.AddRequest{Kind: kind, Data: []byte("x"), Filename: "x"})
		wantCode(t, err, plugin.CodeInvalid)
	}
	if len(srv.calls) != 0 {
		t.Fatal("nothing should reach SABnzbd")
	}
}

func TestAddReportsARefusal(t *testing.T) {
	srv := serveFixtures(t, map[string]func(http.ResponseWriter, *http.Request){
		"addfile": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"status": false, "nzo_ids": []}`))
		},
	})
	_, err := sabnzbd.New(nil).Add(ctx(), srv.conn(key), downloadclient.AddRequest{Kind: downloadclient.PayloadNZB, Data: []byte("x"), Filename: "x"})
	wantCode(t, err, plugin.CodeInvalid)
}

func TestRemoveDeletesFromQueueAndHistory(t *testing.T) {
	for _, deleteData := range []bool{true, false} {
		srv := serveFixtures(t, nil)
		if err := sabnzbd.New(nil).Remove(ctx(), srv.conn(key), "SABnzbd_nzo_done1", deleteData); err != nil {
			t.Fatal(err)
		}
		want := "0"
		if deleteData {
			want = "1"
		}
		if len(srv.calls) != 2 {
			t.Fatalf("%d calls", len(srv.calls))
		}
		for i, mode := range []string{"queue", "history"} {
			q := srv.calls[i].Query
			if q.Get("mode") != mode || q.Get("name") != "delete" || q.Get("value") != "SABnzbd_nzo_done1" || q.Get("del_files") != want {
				t.Errorf("%s delete: %v", mode, q)
			}
		}
	}
}

func TestTestAndCategoryList(t *testing.T) {
	srv := serveFixtures(t, nil)
	c := sabnzbd.New(nil)
	res, err := c.Test(ctx(), srv.conn(key))
	if err != nil || res.Message != "SABnzbd 4.5.1" {
		t.Fatalf("%+v %v", res, err)
	}
	for _, field := range []string{"movie_category", "tv_category"} {
		opts, err := c.ListOptions(ctx(), srv.conn(key), field)
		if err != nil {
			t.Fatal(err)
		}
		var names []string
		for _, o := range opts {
			names = append(names, o.Value)
		}
		if !reflect.DeepEqual(names, []string{"*", "movies", "tv"}) {
			t.Fatalf("%s: %v", field, names)
		}
	}
	_, err = c.ListOptions(ctx(), srv.conn(key), "url")
	wantCode(t, err, plugin.CodeInvalid)
}

func TestABadKeyIsAnAuthErrorThatDoesNotLeakTheKey(t *testing.T) {
	srv := serveFixtures(t, nil)
	_, err := sabnzbd.New(nil).Test(ctx(), srv.conn("wrong-key"))
	wantCode(t, err, plugin.CodeAuth)
	if strings.Contains(err.Error(), "wrong-key") {
		t.Fatalf("error leaks the key: %v", err)
	}
}

func TestAuthFailureShapes(t *testing.T) {
	for name, handler := range map[string]http.HandlerFunc{
		"plain text":  func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("error: API Key Incorrect")) },
		"key missing": func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("error: API Key Required")) },
		"http 403":    func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusForbidden) },
	} {
		t.Run(name, func(t *testing.T) {
			s := httptest.NewServer(handler)
			defer s.Close()
			_, err := sabnzbd.New(nil).List(ctx(), plugin.Connection{Config: map[string]any{"url": s.URL, "api_key": key}}, "")
			wantCode(t, err, plugin.CodeAuth)
		})
	}
}

func TestUnavailableShapes(t *testing.T) {
	notSAB := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("<html>hello</html>")) }))
	defer notSAB.Close()
	broken := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusBadGateway) }))
	defer broken.Close()
	dead := httptest.NewServer(http.NotFoundHandler())
	dead.Close()
	for name, u := range map[string]string{"not SABnzbd": notSAB.URL, "http 502": broken.URL, "refused": dead.URL} {
		t.Run(name, func(t *testing.T) {
			_, err := sabnzbd.New(nil).Test(ctx(), plugin.Connection{Config: map[string]any{"url": u, "api_key": key}})
			wantCode(t, err, plugin.CodeUnavailable)
			if strings.Contains(err.Error(), key) {
				t.Fatalf("error leaks the key: %v", err)
			}
		})
	}
}

func TestABadURLIsInvalid(t *testing.T) {
	_, err := sabnzbd.New(nil).Test(ctx(), plugin.Connection{Config: map[string]any{"url": "sabnzbd:8080", "api_key": key}})
	wantCode(t, err, plugin.CodeInvalid)
}

func TestHonoursContextCancellation(t *testing.T) {
	srv := serveFixtures(t, nil)
	c, cancel := context.WithCancel(ctx())
	cancel()
	if _, err := sabnzbd.New(nil).List(c, srv.conn(key), ""); !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v", err)
	}
}

// ---- conformance ----

func TestSABnzbdPassesTheConformanceSuite(t *testing.T) {
	sab := newStatefulSAB(key)
	srv := httptest.NewServer(sab)
	defer srv.Close()
	dead := httptest.NewServer(http.NotFoundHandler())
	dead.Close()
	good := plugin.Connection{ID: 1, Config: map[string]any{"url": srv.URL, "api_key": key}}
	conformance.Run(t, conformance.Subject{
		Client:        sabnzbd.New(nil),
		Conn:          good,
		BadAuth:       plugin.Connection{ID: 1, Config: map[string]any{"url": srv.URL, "api_key": "nope"}},
		Unreachable:   plugin.Connection{ID: 1, Config: map[string]any{"url": dead.URL, "api_key": key}},
		Backend:       sab,
		Category:      "movies",
		OtherCategory: "tv",
	})
}

// statefulSAB is a small SABnzbd that keeps jobs, answering in the recorded shapes.
type statefulSAB struct {
	key  string
	mu   sync.Mutex
	seq  int
	jobs []*job
}

type job struct {
	id, name, cat, state, storage, msg string
	failure                            downloadclient.Failure
}

func newStatefulSAB(key string) *statefulSAB { return &statefulSAB{key: key} }

func (s *statefulSAB) Complete(id, out string) error {
	return s.set(id, func(j *job) { j.state, j.storage = "Completed", out })
}

func (s *statefulSAB) Fail(id string, f downloadclient.Failure, msg string) error {
	return s.set(id, func(j *job) {
		switch f {
		case downloadclient.FailureEncrypted:
			j.state, j.msg = "Failed", "Aborted, encryption detected"
		case downloadclient.FailureOther:
			j.state, j.msg = "Failed", "Unpacking failed, write error or disk is full?"
		default:
			j.state, j.msg = "Failed", "Repairing failed, "+msg
		}
	})
}

func (s *statefulSAB) set(id string, f func(*job)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, j := range s.jobs {
		if j.id == id {
			f(j)
			return nil
		}
	}
	return fmt.Errorf("no job %s", id)
}

func (s *statefulSAB) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	mode := q.Get("mode")
	if mode == "version" {
		_, _ = w.Write([]byte(`{"version": "4.5.1"}`))
		return
	}
	if q.Get("apikey") != s.key {
		_, _ = w.Write([]byte(`{"status": false, "error": "API Key Incorrect"}`))
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	match := func(cat string) bool { return q.Get("category") == "" || q.Get("category") == cat }
	switch {
	case mode == "get_config":
		_, _ = w.Write([]byte(`{"config": {"categories": [{"name": "*"}, {"name": "movies"}, {"name": "tv"}]}}`))
	case mode == "addfile":
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		f, hdr, err := r.FormFile("name")
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		f.Close()
		s.seq++
		j := &job{id: fmt.Sprintf("SABnzbd_nzo_%d", s.seq), name: strings.TrimSuffix(hdr.Filename, ".nzb"), cat: q.Get("cat"), state: "Queued"}
		s.jobs = append(s.jobs, j)
		_, _ = fmt.Fprintf(w, `{"status": true, "nzo_ids": [%q]}`, j.id)
	case mode == "queue" && q.Get("name") == "delete", mode == "history" && q.Get("name") == "delete":
		for i, j := range s.jobs {
			if j.id == q.Get("value") && (mode == "queue") == (j.state == "Queued") {
				s.jobs = append(s.jobs[:i], s.jobs[i+1:]...)
				break
			}
		}
		_, _ = w.Write([]byte(`{"status": true, "nzo_ids": []}`))
	case mode == "queue":
		var slots []string
		for _, j := range s.jobs {
			if j.state == "Queued" && match(j.cat) {
				slots = append(slots, fmt.Sprintf(`{"nzo_id": %q, "filename": %q, "cat": %q, "status": "Queued", "mb": "100.00", "mbleft": "100.00", "timeleft": "0:00:00"}`, j.id, j.name, j.cat))
			}
		}
		_, _ = fmt.Fprintf(w, `{"queue": {"paused": false, "slots": [%s]}}`, strings.Join(slots, ","))
	case mode == "history":
		var slots []string
		for _, j := range s.jobs {
			if j.state != "Queued" && match(j.cat) {
				slots = append(slots, fmt.Sprintf(`{"nzo_id": %q, "name": %q, "category": %q, "status": %q, "fail_message": %q, "storage": %q, "bytes": 104857600}`, j.id, j.name, j.cat, j.state, j.msg, j.storage))
			}
		}
		_, _ = fmt.Fprintf(w, `{"history": {"slots": [%s]}}`, strings.Join(slots, ","))
	default:
		http.NotFound(w, r)
	}
}

// ---- helpers ----

func wantCode(t *testing.T, err error, want plugin.Code) {
	t.Helper()
	var pe *plugin.Error
	if !errors.As(err, &pe) || pe.Code != want {
		t.Fatalf("want %s error, got %v", want, err)
	}
}
