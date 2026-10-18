// Package history owns the append-only events log. Every loop change the UI
// must see records an event (ADR 0010); the API's SSE stream tails the log.
//
// Recording is one line from any module that sits above history:
//
//	s.history.Record(ctx, history.Event{Kind: history.GrabSent, TitleID: id, GrabID: g})
//
// To add a kind, declare a Kind constant, say in routine whether it is pruned
// after 30 days, and map it to hints in internal/api/stream.go.
package history

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/hyprsh/kestrel/internal/history/db"
	"github.com/hyprsh/kestrel/internal/store"
)

// Kind says what happened. The set grows; clients tolerate unknown kinds.
type Kind string

// Kinds recorded so far. Routine ones are pruned after 30 days, the others are
// kept forever.
const (
	// GrabSent: a Release was sent to the download client.
	GrabSent Kind = "grab"
	// GrabDownloading: the client started on a Grab (routine).
	GrabDownloading Kind = "grab_downloading"
	// GrabCompleted: the client finished a Grab's download (routine).
	GrabCompleted Kind = "grab_completed"
	// GrabFailed: the client reported a Grab failed.
	GrabFailed Kind = "grab_failed"
	// GrabCanceled: a Grab was canceled by hand.
	GrabCanceled Kind = "grab_canceled"
	// ImportDone: a completed Grab's file is in the library.
	ImportDone Kind = "import"
	// ImportRejected: the Import found the Release unfit (invalid, resolution, language, not_upgrade).
	ImportRejected Kind = "import_rejected"
	// ImportStalled: the Import cannot proceed until the environment is fixed; recorded once per stall.
	ImportStalled Kind = "import_stalled"
	// ImportEpisode: what an Import did for one episode of a Series Grab (imported,
	// or left alone because it was unmonitored, held or unreadable). Data carries
	// the result.
	ImportEpisode Kind = "import_episode"
	// RequestCreated: a new Request arrived (a retry of a stored one does not record).
	RequestCreated Kind = "request"
	// HealthRaised: a Needs attention row appeared (a repeat of one already showing does not record).
	HealthRaised Kind = "health_raised"
	// HealthCleared: a Needs attention row cleared itself.
	HealthCleared Kind = "health_cleared"
)

var routine = map[Kind]bool{GrabDownloading: true, GrabCompleted: true}

// IsRoutine reports whether events of this kind are pruned after 30 days.
func IsRoutine(k Kind) bool { return routine[k] }

// RoutineLife is how long routine events are kept.
const RoutineLife = 30 * 24 * time.Hour

// Event is one row of the log. Zero ids mean "not about one".
type Event struct {
	ID        int64
	At        time.Time
	Kind      Kind
	Routine   bool
	TitleID   int64
	VersionID int64
	EpisodeID int64
	GrabID    int64
	RequestID int64
	Message   string
	// Data is the kind's JSON payload, if it has one.
	Data json.RawMessage
}

// Service records and reads events.
type Service struct {
	st    *store.Store
	clock func() time.Time
	log   *slog.Logger
}

// New returns a Service. A nil clock means time.Now and a nil logger slog.Default().
func New(st *store.Store, clock func() time.Time, log *slog.Logger) *Service {
	if clock == nil {
		clock = time.Now
	}
	if log == nil {
		log = slog.Default()
	}
	return &Service{st: st, clock: clock, log: log}
}

// Record appends an event. The clock and the kind decide At and Routine; the
// event's own are ignored. A failure is logged, never
// returned: losing a hint must not fail the work that caused it. Safe on a nil
// Service, so modules built without history in a test just skip it.
func (s *Service) Record(ctx context.Context, ev Event) {
	if s == nil {
		return
	}
	var data sql.NullString
	if len(ev.Data) > 0 {
		data = sql.NullString{String: string(ev.Data), Valid: true}
	}
	_, err := db.New(s.st.Write()).InsertEvent(ctx, db.InsertEventParams{
		At: s.clock().UTC().Format(time.RFC3339), Kind: string(ev.Kind), Routine: b2i(IsRoutine(ev.Kind)),
		TitleID: nullID(ev.TitleID), VersionID: nullID(ev.VersionID), EpisodeID: nullID(ev.EpisodeID),
		GrabID: nullID(ev.GrabID), RequestID: nullID(ev.RequestID), Message: ev.Message, Data: data,
	})
	if err != nil {
		s.log.Error("recording an event failed", "kind", ev.Kind, "err", err)
	}
}

// After returns up to limit events with an id above id, oldest first.
func (s *Service) After(ctx context.Context, id int64, limit int) ([]Event, error) {
	rows, err := db.New(s.st.Read()).EventsAfter(ctx, db.EventsAfterParams{ID: id, Limit: int64(limit)})
	if err != nil {
		return nil, err
	}
	out := make([]Event, 0, len(rows))
	for _, r := range rows {
		at, _ := time.Parse(time.RFC3339, r.At)
		ev := Event{
			ID: r.ID, At: at, Kind: Kind(r.Kind), Routine: r.Routine == 1, TitleID: r.TitleID.Int64, VersionID: r.VersionID.Int64,
			EpisodeID: r.EpisodeID.Int64, GrabID: r.GrabID.Int64, RequestID: r.RequestID.Int64, Message: r.Message,
		}
		if r.Data.Valid {
			ev.Data = json.RawMessage(r.Data.String)
		}
		out = append(out, ev)
	}
	return out, nil
}

// Last is the id of the newest event, 0 when the log is empty.
func (s *Service) Last(ctx context.Context) (int64, error) {
	return db.New(s.st.Read()).LastEventID(ctx)
}

// Prune deletes routine events older than RoutineLife and reports how many.
func (s *Service) Prune(ctx context.Context) (int64, error) {
	cutoff := s.clock().Add(-RoutineLife).UTC().Format(time.RFC3339)
	return db.New(s.st.Write()).PruneRoutineEvents(ctx, cutoff)
}

func nullID(n int64) sql.NullInt64 { return sql.NullInt64{Int64: n, Valid: n != 0} }

func b2i(b bool) int64 {
	if b {
		return 1
	}
	return 0
}
