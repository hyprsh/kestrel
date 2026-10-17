package api_test

import (
	"bufio"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/api"
	"github.com/hyprsh/kestrel/internal/jobs"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
)

// sseEvent is one frame of the stream.
type sseEvent struct {
	Name string
	Data string
}

type sseStream struct {
	t      *testing.T
	status int
	mu     sync.Mutex
	all    []sseEvent // every frame received, in order
	from   int        // frames before this index are not looked at by until
}

// stream opens GET /stream as this browser, like a tab's EventSource.
func (b *browser) stream(t *testing.T) *sseStream {
	t.Helper()
	req, err := http.NewRequest("GET", b.in.srv.URL+b.in.base+"/api/v1/stream", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Accept", "text/event-stream")
	for _, c := range b.cookies {
		req.AddCookie(c)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	s := &sseStream{t: t, status: res.StatusCode}
	t.Cleanup(func() { res.Body.Close() })
	if res.StatusCode != 200 {
		return s
	}
	if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Fatalf("stream content type = %q", ct)
	}
	go func() {
		sc := bufio.NewScanner(res.Body)
		var cur sseEvent
		for sc.Scan() {
			line := sc.Text()
			switch {
			case line == "":
				if cur.Name != "" {
					s.push(cur)
				}
				cur = sseEvent{}
			case strings.HasPrefix(line, ":"):
				s.push(sseEvent{Name: "comment", Data: strings.TrimSpace(line[1:])})
			case strings.HasPrefix(line, "event: "):
				cur.Name = line[len("event: "):]
			case strings.HasPrefix(line, "data: "):
				cur.Data += line[len("data: "):]
			}
		}
	}()
	return s
}

func (s *sseStream) push(e sseEvent) {
	s.mu.Lock()
	s.all = append(s.all, e)
	s.mu.Unlock()
}

// mark makes later waits look only at frames that arrive from now on.
func (s *sseStream) mark() {
	s.mu.Lock()
	s.from = len(s.all)
	s.mu.Unlock()
}

// frames are the frames received since the last mark.
func (s *sseStream) frames() []sseEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]sseEvent(nil), s.all[s.from:]...)
}

// until waits for a frame since the last mark that satisfies ok. Frames are
// kept, so waits can come in any order.
func (s *sseStream) until(what string, ok func(sseEvent) bool) sseEvent {
	s.t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		for _, e := range s.frames() {
			if ok(e) {
				return e
			}
		}
		time.Sleep(5 * time.Millisecond)
	}
	s.t.Fatalf("no %s within 5s", what)
	return sseEvent{}
}

// hint waits for a `changed` hint for a resource.
func (s *sseStream) hint(resource string) {
	s.t.Helper()
	s.until("changed hint for "+resource, func(e sseEvent) bool {
		if e.Name != "changed" {
			return false
		}
		var h struct {
			Resource string `json:"resource"`
		}
		return json.Unmarshal([]byte(e.Data), &h) == nil && h.Resource == resource
	})
}

// queue waits for a `queue` snapshot satisfying ok.
func (s *sseStream) queue(what string, ok func([]queueItemJSON) bool) {
	s.t.Helper()
	s.until("queue snapshot: "+what, func(e sseEvent) bool {
		var q struct {
			Items []queueItemJSON `json:"items"`
		}
		return e.Name == "queue" && json.Unmarshal([]byte(e.Data), &q) == nil && ok(q.Items)
	})
}

func fastStream(o *api.Options) {
	o.Stream = api.StreamIntervals{Events: 20 * time.Millisecond, Snapshots: 20 * time.Millisecond, Heartbeat: 100 * time.Millisecond}
}

func TestTheStreamShowsAGrabAndItsStateChangesAsHintsAndQueueSnapshots(t *testing.T) {
	s := newSearchBare(t, fastStream)
	s.addPaddington(t)
	s.publish(t, goodRelease)
	st := s.stream(t)
	st.queue("empty", func(items []queueItemJSON) bool { return len(items) == 0 })

	st.mark()
	s.pass(t, jobs.Search)

	st.hint("grab")
	st.hint("queue")
	st.queue("one queued Grab", func(items []queueItemJSON) bool {
		return len(items) >= 1 && items[0].ReleaseName == goodRelease && items[0].Phase == "queued"
	})

	id := s.jobs(t)[0].ClientID
	if err := s.sab.SetPhase(id, downloadclient.PhaseDownloading, 400); err != nil {
		t.Fatal(err)
	}
	st.mark()
	s.pass(t, jobs.Poll)
	st.queue("downloading with bytes left", func(items []queueItemJSON) bool {
		return len(items) == 1 && items[0].Phase == "downloading" && items[0].BytesLeft == 400
	})

	if err := s.sab.Complete(id, "/data/usenet/movies/Paddington"); err != nil {
		t.Fatal(err)
	}
	st.mark()
	s.pass(t, jobs.Poll)
	st.hint("title")
	st.queue("importing", func(items []queueItemJSON) bool { return len(items) == 1 && items[0].Phase == "importing" })
}

func TestTheStreamDoesNotReplayWhatHappenedBeforeItOpened(t *testing.T) {
	s := newSearchBare(t, fastStream)
	s.addPaddington(t)
	s.publish(t, goodRelease)
	s.pass(t, jobs.Search)

	st := s.stream(t)

	st.until("heartbeat", func(e sseEvent) bool { return e.Name == "comment" })
	for _, e := range st.frames() {
		if e.Name == "changed" {
			t.Fatalf("replayed %+v", e)
		}
	}
}

func TestTheStreamHintsAChangeMadeThroughTheAPIItself(t *testing.T) {
	s := newSearchBare(t, fastStream)
	st := s.stream(t)
	st.until("first frame", func(e sseEvent) bool { return e.Name == "queue" })

	st.mark()
	s.addPaddington(t)

	st.hint("title")
}

func TestTheStreamSendsActivityAndAttentionSnapshotsAndHeartbeats(t *testing.T) {
	s := newSearchBare(t, fastStream)
	st := s.stream(t)

	got := map[string]string{}
	st.until("activity, attention and a heartbeat", func(e sseEvent) bool {
		got[e.Name] = e.Data
		return got["activity"] != "" && got["attention"] != "" && got["comment"] != ""
	})
	if !strings.Contains(got["activity"], `"running"`) || !strings.Contains(got["attention"], `"count"`) {
		t.Errorf("activity %q, attention %q", got["activity"], got["attention"])
	}
}

func TestTheStreamIsClosedWith401WithoutALogin(t *testing.T) {
	in := newInstance(t, "")
	in.setUp()

	st := in.browser().stream(t)

	if st.status != 401 {
		t.Fatalf("anonymous stream = %d, want 401", st.status)
	}
}
