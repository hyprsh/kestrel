package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/history"
)

// StreamIntervals sets how often GET /stream polls and beats. Zero fields mean
// the defaults (events 1 s, snapshots 2 s, heartbeat 15 s); tests shorten them.
type StreamIntervals struct {
	// Events is how often the events log is read for new rows.
	Events time.Duration
	// Snapshots is how often the in-memory queue, activity and attention state is compared with what was last sent.
	Snapshots time.Duration
	// Heartbeat is the gap after which an idle stream writes a comment line.
	Heartbeat time.Duration
}

func (i StreamIntervals) withDefaults() StreamIntervals {
	if i.Events <= 0 {
		i.Events = time.Second
	}
	if i.Snapshots <= 0 {
		i.Snapshots = 2 * time.Second
	}
	if i.Heartbeat <= 0 {
		i.Heartbeat = 15 * time.Second
	}
	return i
}

// resource names what a `changed` hint tells the SPA to refetch.
type resource string

const (
	resAdoption  resource = "adoption"
	resAttention resource = "attention"
	resBlocklist resource = "blocklist"
	resGrab      resource = "grab"
	resLog       resource = "log"
	resQueue     resource = "queue"
	resRequest   resource = "request"
	resTitle     resource = "title"
)

// hint is a `changed` frame: refetch this resource.
type hint struct {
	Resource resource `json:"resource"`
	ID       *int64   `json:"id"`
}

func hintOf(resource resource, id int64) hint {
	h := hint{Resource: resource}
	if id != 0 {
		h.ID = &id
	}
	return h
}

// hintsOf maps a recorded event to the hints it causes. To make a new kind
// visible, add what it touches here. Anything about a Title or Grab refetches
// them; Grab kinds also refresh "Downloading now"; every event refreshes the Log.
func hintsOf(ev history.Event) []hint {
	var out []hint
	if ev.TitleID != 0 {
		out = append(out, hintOf(resTitle, ev.TitleID))
	}
	if ev.GrabID != 0 {
		out = append(out, hintOf(resGrab, ev.GrabID))
	}
	if ev.RequestID != 0 {
		out = append(out, hintOf(resRequest, ev.RequestID))
	}
	if strings.HasPrefix(string(ev.Kind), "grab") || strings.HasPrefix(string(ev.Kind), "import") {
		out = append(out, hintOf(resQueue, 0))
	}
	if ev.Kind == history.Blocklisted {
		out = append(out, hintOf(resBlocklist, 0))
	}
	if strings.HasPrefix(string(ev.Kind), "adoption") {
		out = append(out, hintOf(resAdoption, 0))
	}
	if strings.HasPrefix(string(ev.Kind), "health") || strings.HasPrefix(string(ev.Kind), "import") || ev.Kind == history.TitleRefreshed {
		// Stalled Imports are Needs attention rows too.
		out = append(out, hintOf(resAttention, 0))
	}
	return append(out, hintOf(resLog, 0))
}

// hub carries the hints handlers emit for changes made through the API itself
// to the open streams of this process. It holds no state beyond the listeners.
type hub struct {
	mu   sync.Mutex
	subs map[chan hint]struct{}
}

func newHub() *hub { return &hub{subs: map[chan hint]struct{}{}} }

func (h *hub) subscribe() (<-chan hint, func()) {
	ch := make(chan hint, 64)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	return ch, func() {
		h.mu.Lock()
		delete(h.subs, ch)
		h.mu.Unlock()
	}
}

// publish never blocks: a stream that fell 64 hints behind misses some, and the
// next reconnect refetches everything anyway.
func (h *hub) publish(hs ...hint) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		for _, x := range hs {
			select {
			case ch <- x:
			default:
			}
		}
	}
}

// apiHints are the hints a successful call of an operation causes. Changes made
// by background loops reach the stream through the events log instead.
var apiHints = map[string][]hint{
	"CreateTitle":           {hintOf(resTitle, 0)},
	"PatchTitle":            {hintOf(resTitle, 0)},
	"PatchSeason":           {hintOf(resTitle, 0)},
	"MonitorEpisodes":       {hintOf(resTitle, 0)},
	"AddVersion":            {hintOf(resTitle, 0)},
	"PatchVersion":          {hintOf(resTitle, 0)},
	"DeleteVersion":         {hintOf(resTitle, 0), hintOf(resQueue, 0)},
	"DeleteTitle":           {hintOf(resTitle, 0), hintOf(resQueue, 0)},
	"CreateGrab":            {hintOf(resGrab, 0), hintOf(resQueue, 0), hintOf(resTitle, 0)},
	"CancelGrab":            {hintOf(resGrab, 0), hintOf(resQueue, 0), hintOf(resTitle, 0)},
	"RetryGrabImport":       {hintOf(resGrab, 0), hintOf(resQueue, 0), hintOf(resAttention, 0)},
	"DiscardGrab":           {hintOf(resGrab, 0), hintOf(resQueue, 0), hintOf(resTitle, 0), hintOf(resAttention, 0)},
	"RetryStalledImports":   {hintOf(resGrab, 0), hintOf(resQueue, 0), hintOf(resAttention, 0)},
	"DiscardStalledImports": {hintOf(resGrab, 0), hintOf(resQueue, 0), hintOf(resTitle, 0), hintOf(resAttention, 0)},
	"ScanAdoption":          {hintOf(resAdoption, 0)},
	"PatchAdoptionRow":      {hintOf(resAdoption, 0)},
	"CommitAdoption":        {hintOf(resAdoption, 0)},
	"DiscardAdoption":       {hintOf(resAdoption, 0)},
	"DismissAttention":      {hintOf(resAttention, 0)},
	"DeleteBlocklistEntry":  {hintOf(resBlocklist, 0)},
}

// emitHints is a strict-server middleware that publishes an operation's hints
// after it ran.
func (s *server) emitHints(next oapi.StrictHandlerFunc, operationID string) oapi.StrictHandlerFunc {
	hs, ok := apiHints[operationID]
	if !ok {
		return next
	}
	return func(ctx context.Context, w http.ResponseWriter, r *http.Request, request any) (any, error) {
		res, err := next(ctx, w, r, request)
		if err == nil {
			s.hub.publish(hs...)
		}
		return res, err
	}
}

// Stream is GET /stream. The response object runs the stream itself: the
// generated server would copy a body once, not flush as frames come.
func (s *server) Stream(ctx context.Context, _ oapi.StreamRequestObject) (oapi.StreamResponseObject, error) {
	// Taken before the first byte goes out, so nothing recorded after the
	// client sees the stream open is missed.
	last, err := s.history.Last(ctx)
	if err != nil {
		return nil, err
	}
	return streamResponse{s: s, ctx: ctx, last: last}, nil
}

type streamResponse struct {
	s    *server
	ctx  context.Context
	last int64
}

func (r streamResponse) VisitStreamResponse(w http.ResponseWriter) error {
	s := r.s
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeProblem(w, http.StatusInternalServerError, "internal", "streaming is not supported here")
		return nil
	}
	iv := s.opts.Stream.withDefaults()
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	hints, unsubscribe := s.hub.subscribe()
	defer unsubscribe()

	var buf bytes.Buffer
	send := func(event string, v any) bool {
		data, err := json.Marshal(v)
		if err != nil {
			return true
		}
		buf.Reset()
		buf.WriteString("event: " + event + "\ndata: ")
		buf.Write(data)
		buf.WriteString("\n\n")
		_, err = w.Write(buf.Bytes())
		flusher.Flush()
		return err == nil
	}
	sentAny := time.Now()
	sent := map[string][]byte{}
	// snapshot sends a state frame when it differs from the last one sent.
	snapshot := func(event string, v any) bool {
		data, err := json.Marshal(v)
		if err != nil || bytes.Equal(sent[event], data) {
			return true
		}
		sent[event] = data
		sentAny = time.Now()
		return send(event, json.RawMessage(data))
	}
	snapshots := func() bool {
		ctx := r.ctx
		if q, err := s.ListQueue(ctx, oapi.ListQueueRequestObject{}); err == nil {
			if !snapshot("queue", q) {
				return false
			}
		}
		if !snapshot("activity", oapi.ActivitySnapshot{Running: nonNil(s.jobs.Running())}) {
			return false
		}
		if n, sev, err := s.attention(ctx); err == nil {
			var severity *oapi.AttentionSnapshotSeverity
			if sev != nil {
				v := oapi.AttentionSnapshotSeverity(*sev)
				severity = &v
			}
			return snapshot("attention", oapi.AttentionSnapshot{Count: n, Severity: severity})
		}
		return true
	}
	if !snapshots() {
		return nil
	}

	events, snaps, beat := time.NewTicker(iv.Events), time.NewTicker(iv.Snapshots), time.NewTicker(iv.Heartbeat)
	defer events.Stop()
	defer snaps.Stop()
	defer beat.Stop()
	last := r.last
	for {
		select {
		case <-r.ctx.Done():
			return nil
		case x := <-hints:
			sentAny = time.Now()
			if !send("changed", x) {
				return nil
			}
		case <-events.C:
			evs, err := s.history.After(r.ctx, last, 200)
			if err != nil {
				continue
			}
			var seen []hint
			for _, ev := range evs {
				last = ev.ID
				for _, x := range hintsOf(ev) {
					if !slices.ContainsFunc(seen, func(y hint) bool { return y.Resource == x.Resource && ptrEq(y.ID, x.ID) }) {
						seen = append(seen, x)
					}
				}
			}
			for _, x := range seen {
				sentAny = time.Now()
				if !send("changed", x) {
					return nil
				}
			}
		case <-snaps.C:
			if !snapshots() {
				return nil
			}
		case <-beat.C:
			if time.Since(sentAny) < iv.Heartbeat {
				continue
			}
			sentAny = time.Now()
			if _, err := w.Write([]byte(": heartbeat\n\n")); err != nil {
				return nil
			}
			flusher.Flush()
		}
	}
}

func ptrEq(a, b *int64) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
