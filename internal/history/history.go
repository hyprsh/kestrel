// Package history owns the append-only events log. Every loop change the UI
// must see records an event (ADR 0010); the API's SSE stream tails the log.
//
// Recording is one line from any module that sits above history:
//
//	s.history.Record(ctx, history.Event{Kind: history.GrabSent, TitleID: id, GrabID: g, Reason: "chosen by a search"})
//
// Every event says why (Reason) and who or what started it (Trigger). The Trigger may be left to the context
// (WithTrigger: an API request carries its person, a loop's pass its job); the Reason is always the caller's.
// A test fails when an event has neither, in the Service or in the source (see TestEveryEventSaysWhy).
//
// To add a kind, declare a Kind constant, say in routine whether it is pruned
// after 30 days, and map it to hints in internal/api/stream.go.
package history

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"testing"
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
	// ImportRejected: the Import found the Release unfit (invalid, resolution, language, not_upgrade, incomplete_archive).
	ImportRejected Kind = "import_rejected"
	// ImportStalled: the Import cannot proceed until the environment is fixed; recorded once per stall.
	ImportStalled Kind = "import_stalled"
	// AdoptionScanned: an Adoption scan built a plan for review (routine).
	AdoptionScanned Kind = "adoption_scanned"
	// AdoptionDone: Adoption took a Title over with the files it already had.
	AdoptionDone Kind = "adoption"
	// CleanupDone: Clean up deleted a Title folder's Unmanaged files.
	CleanupDone Kind = "cleanup"
	// ImportEpisode: what an Import did for one episode of a Series Grab (imported,
	// or left alone because it was unmonitored, held or unreadable). Data carries
	// the result.
	ImportEpisode Kind = "import_episode"
	// RequestCreated: a new Request arrived (a retry of a stored one does not record).
	RequestCreated Kind = "request"
	// RequestEnded: a Request was ended by hand and now reads as rejected; the message says why.
	RequestEnded Kind = "request_ended"
	// WatchAheadAdded: Watch-ahead added the next season to a Request (ADR 0019).
	WatchAheadAdded Kind = "watch_ahead"
	// Renamed: a Title's folder and files were renamed after its English title or year changed.
	Renamed Kind = "rename"
	// Moved: a Title was moved to another Root folder. Data carries from and to.
	Moved Kind = "move"
	// FilesDeleted: files of a Version were deleted by hand; the Version stays. Data carries the paths and episode ids.
	FilesDeleted Kind = "delete"
	// TitleRefreshed: a Title's metadata was refreshed in the background (routine).
	TitleRefreshed Kind = "title_refreshed"
	// Blocklisted: a Release went on the Blocklist.
	Blocklisted Kind = "blocklist"
	// HealthRaised: a Needs attention row appeared (a repeat of one already showing does not record).
	HealthRaised Kind = "health_raised"
	// HealthCleared: a Needs attention row cleared itself.
	HealthCleared Kind = "health_cleared"
	// BulkAction: a person ran one action over many Titles (the Library's bulk edit). One entry for the whole
	// call; Data carries the action, how many Titles it named and how each came out.
	BulkAction Kind = "bulk"
	// Searched: one Version's search ended, whoever started it (the Trigger says); the message says what it found (routine).
	Searched Kind = "search"
	// OriginalOffered: a Release with the Title's Original Language only was offered for a Version, or
	// replaced a lower-scoring offer (routine).
	OriginalOffered Kind = "original_offered"

	// PlaceholderAdded: a Placeholder Episode was created for an episode a Release names before TheTVDB lists it
	// (ADR 0013). One entry per episode; the reason names the Release or file.
	PlaceholderAdded Kind = "placeholder"
	// FileMisfit: a file was marked misfit because it no longer passes its Version's Profile, which makes the
	// Version Wanted. The reason names what did not fit. Data carries the file id and path.
	FileMisfit Kind = "file_misfit"
	// FileRescored: a re-score gave a file a different Score; the message has the old and the new one and the
	// reason what changed. A file whose Score stayed the same writes nothing (routine).
	FileRescored Kind = "file_rescored"
)

// Kinds for changes to the configuration: Profiles, Slots, settings and the Blocklist (#399). They are kept
// together so a block of Kinds for another area merges next to them. None is routine, and none carries a secret.
const (
	// ProfileCreated: a Profile was made, by copy or from a recipe. Data carries its key and name.
	ProfileCreated Kind = "profile_created"
	// ProfileChanged: a Profile was edited. Data carries its key and the fields that changed.
	ProfileChanged Kind = "profile_changed"
	// ProfileDeleted: a Profile was deleted. Data carries its key and name.
	ProfileDeleted Kind = "profile_deleted"
	// SlotCreated: a Slot was made. Data carries its id and label.
	SlotCreated Kind = "slot_created"
	// SlotChanged: a Slot was edited. Data carries its id and the fields that changed.
	SlotChanged Kind = "slot_changed"
	// SlotDeleted: a Slot was deleted. Data carries its id and label.
	SlotDeleted Kind = "slot_deleted"
	// SlotsPreset: a Slot preset replaced the Slots (and the Profiles it brings). Data carries the preset id.
	SlotsPreset Kind = "slots_preset"
	// SettingsChanged: settings were saved. Data carries the keys that changed ("keys"), never their values.
	SettingsChanged Kind = "settings_changed"
	// GrabsPaused: Pause Grabs was turned on.
	GrabsPaused Kind = "grabs_paused"
	// GrabsResumed: Pause Grabs was turned off.
	GrabsResumed Kind = "grabs_resumed"
	// BlocklistRemoved: a Release came off the Blocklist and can be grabbed again.
	BlocklistRemoved Kind = "blocklist_removed"
)

// The Library's changes (a Title added by hand or by a Request, removed, a Version added or removed, monitoring
// changed). The Trigger says who or what; Data carries the ids, since a removed row cannot be the entry's TitleID.
const (
	// TitleAdded: a Title went into the Library (by hand, by a Request).
	TitleAdded Kind = "title_added"
	// TitleRemoved: a Title was removed from the Library with its Versions; Data carries its id, kind and name.
	TitleRemoved Kind = "title_removed"
	// VersionAdded: a Version was added to a Title.
	VersionAdded Kind = "version_added"
	// VersionRemoved: a Version was removed from a Title; Data carries its id, Slot and Profile.
	VersionRemoved Kind = "version_removed"
	// MonitoringChanged: a Title, season or episodes were monitored or unmonitored, or a Series' mode or options
	// changed; Data.scope says which ("title", "season", "episodes", "options").
	MonitoringChanged Kind = "monitoring"
)

var routine = map[Kind]bool{GrabDownloading: true, GrabCompleted: true, AdoptionScanned: true, TitleRefreshed: true, Searched: true, OriginalOffered: true, FileRescored: true}

// IsRoutine reports whether events of this kind are pruned after 30 days.
func IsRoutine(k Kind) bool { return routine[k] }

// Severity is how much an event's kind matters to the Log's strip and its Errors and Warnings views.
type Severity int

const (
	// Plain: nothing went wrong.
	Plain Severity = iota
	// Warning: something wants a look (an Import stalled, a Needs attention row, an Original Offer).
	Warning
	// Failure: something went wrong (a Grab failed, an Import was rejected, a Release was blocklisted).
	Failure
)

// SeverityOf is the severity of a kind. It matches the web Log's Errors and Warnings views.
func SeverityOf(k Kind) Severity {
	switch k {
	case GrabFailed, ImportRejected, Blocklisted:
		return Failure
	case ImportStalled, HealthRaised, OriginalOffered:
		return Warning
	}
	return Plain
}

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
	// Trigger is who or what started the action. Left zero, Record takes the context's (WithTrigger).
	Trigger Trigger
	// Reason is why it happened, or why something was not done: "due: 3 days after it became Wanted",
	// "retry: import of X rejected: language". Required.
	Reason string
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
//
// An event with no Reason, or with no Trigger of its own or in ctx, is still written (the action it describes must
// not fail for it) but logged as an error; under `go test` it panics, so a caller that leaves them empty fails its test.
func (s *Service) Record(ctx context.Context, ev Event) {
	if s == nil {
		return
	}
	if ev.Trigger.IsZero() {
		ev.Trigger = TriggerOf(ctx)
	}
	var data sql.NullString
	if len(ev.Data) > 0 {
		data = sql.NullString{String: string(ev.Data), Valid: true}
	}
	_, err := db.New(s.st.Write()).InsertEvent(ctx, db.InsertEventParams{
		At: s.clock().UTC().Format(time.RFC3339), Kind: string(ev.Kind), Routine: b2i(IsRoutine(ev.Kind)),
		TitleID: nullID(ev.TitleID), VersionID: nullID(ev.VersionID), EpisodeID: nullID(ev.EpisodeID),
		GrabID: nullID(ev.GrabID), RequestID: nullID(ev.RequestID), Message: ev.Message, Data: data,
		TriggerKind: string(ev.Trigger.Kind), TriggerActor: ev.Trigger.Actor, TriggerVia: ev.Trigger.Via, Reason: ev.Reason,
	})
	if err != nil {
		s.log.Error("recording an event failed", "kind", ev.Kind, "err", err)
	}
	if ev.Trigger.IsZero() || ev.Reason == "" {
		s.log.Error("an event has no trigger or reason", "kind", ev.Kind, "message", ev.Message)
		if testing.Testing() {
			panic("history: event " + string(ev.Kind) + " (" + ev.Message + ") has no trigger or no reason")
		}
	}
}

// After returns up to limit events with an id above id, oldest first.
func (s *Service) After(ctx context.Context, id int64, limit int) ([]Event, error) {
	rows, err := db.New(s.st.Read()).EventsAfter(ctx, db.EventsAfterParams{ID: id, Limit: int64(limit)})
	if err != nil {
		return nil, err
	}
	return eventsOf(rows), nil
}

func eventsOf(rows []db.Event) []Event {
	out := make([]Event, 0, len(rows))
	for _, r := range rows {
		at, _ := time.Parse(time.RFC3339, r.At)
		ev := Event{
			ID: r.ID, At: at, Kind: Kind(r.Kind), Routine: r.Routine == 1, TitleID: r.TitleID.Int64, VersionID: r.VersionID.Int64,
			EpisodeID: r.EpisodeID.Int64, GrabID: r.GrabID.Int64, RequestID: r.RequestID.Int64, Message: r.Message,
			Trigger: Trigger{Kind: TriggerKind(r.TriggerKind), Actor: r.TriggerActor, Via: r.TriggerVia}, Reason: r.Reason,
		}
		if r.Data.Valid {
			ev.Data = json.RawMessage(r.Data.String)
		}
		out = append(out, ev)
	}
	return out
}

// Filter narrows the Log. Empty fields match everything; a list matches any of its values.
type Filter struct {
	Kinds []Kind
	// ExcludeKinds leaves these kinds out, even when Kinds names them.
	ExcludeKinds []Kind
	TitleIDs     []int64
	// Slots are "standard" or "4k": events about a Version in one of them.
	Slots []string
	// ExcludeTitleIDs and ExcludeSlots leave out the events about those Titles
	// and Slots, even when TitleIDs or Slots name them. An event about no Title
	// or Version stays.
	ExcludeTitleIDs []int64
	ExcludeSlots    []string
	// GrabID keeps only the events about that Grab; zero is every Grab.
	GrabID int64
	// Routine includes routine events, which the Log hides by default.
	Routine bool
	// Before returns only events with a smaller id, for paging.
	Before int64
	// Limit caps the result; zero means 200.
	Limit int
}

// List returns the Log newest first.
func (s *Service) List(ctx context.Context, f Filter) ([]Event, error) {
	p := db.ListEventsParams{WithRoutine: b2i(f.Routine), MaxRows: int64(f.Limit)}
	if p.MaxRows <= 0 {
		p.MaxRows = 200
	}
	p.Kinds, p.ExcludeKinds, p.TitleIds, p.Slots = jsonList(f.Kinds), jsonList(f.ExcludeKinds), jsonList(f.TitleIDs), jsonList(f.Slots)
	p.ExcludeTitleIds, p.ExcludeSlots = jsonList(f.ExcludeTitleIDs), jsonList(f.ExcludeSlots)
	if f.Before != 0 {
		p.Before = f.Before
	}
	if f.GrabID != 0 {
		p.GrabID = f.GrabID
	}
	rows, err := db.New(s.st.Read()).ListEvents(ctx, p)
	if err != nil {
		return nil, err
	}
	return eventsOf(rows), nil
}

// Last is the id of the newest event, 0 when the log is empty.
func (s *Service) Last(ctx context.Context) (int64, error) {
	return db.New(s.st.Read()).LastEventID(ctx)
}

// Summary is what the Log holds: events per kind (routine included) and when the oldest happened (zero when empty).
type Summary struct {
	Counts map[Kind]int64
	Oldest time.Time
}

// Summary counts the events by kind and finds the oldest.
func (s *Service) Summary(ctx context.Context) (Summary, error) {
	q := db.New(s.st.Read())
	rows, err := q.EventKindCounts(ctx)
	if err != nil {
		return Summary{}, err
	}
	out := Summary{Counts: map[Kind]int64{}}
	for _, r := range rows {
		out.Counts[Kind(r.Kind)] = r.N
	}
	oldest, err := q.OldestEventAt(ctx)
	if err != nil {
		return Summary{}, err
	}
	if oldest != "" {
		if out.Oldest, err = time.Parse(time.RFC3339, oldest); err != nil {
			return Summary{}, err
		}
	}
	return out, nil
}

// Bucket is the events of one stretch of time, by severity.
type Bucket struct {
	Start    time.Time
	Events   int64
	Warnings int64
	Errors   int64
}

// Histogram counts the events of the last days days in buckets of the given length, oldest first, empty buckets
// included. Buckets start at multiples of their length from the epoch (midnight UTC for a day or an hour), and the
// last one is the one now falls in.
func (s *Service) Histogram(ctx context.Context, bucket time.Duration, days int) ([]Bucket, error) {
	secs := int64(bucket / time.Second)
	if secs <= 0 || days <= 0 {
		return nil, nil
	}
	now := s.clock().UTC()
	first := (now.Add(-time.Duration(days)*24*time.Hour).Unix() / secs)
	last := now.Unix() / secs
	rows, err := db.New(s.st.Read()).EventBuckets(ctx, db.EventBucketsParams{BucketSecs: secs, Since: time.Unix(first*secs, 0).UTC().Format(time.RFC3339)})
	if err != nil {
		return nil, err
	}
	out := make([]Bucket, last-first+1)
	for i := range out {
		out[i].Start = time.Unix((first+int64(i))*secs, 0).UTC()
	}
	for _, r := range rows {
		i := r.Bucket - first
		if i < 0 || i >= int64(len(out)) {
			continue
		}
		switch SeverityOf(Kind(r.Kind)) {
		case Failure:
			out[i].Errors += r.N
		case Warning:
			out[i].Warnings += r.N
		default:
			out[i].Events += r.N
		}
	}
	return out, nil
}

// Prune deletes routine events older than RoutineLife and reports how many.
func (s *Service) Prune(ctx context.Context) (int64, error) {
	cutoff := s.clock().Add(-RoutineLife).UTC().Format(time.RFC3339)
	return db.New(s.st.Write()).PruneRoutineEvents(ctx, cutoff)
}

// jsonList is a list filter's query argument: a JSON array for json_each, or NULL (no filter)
// when the list is empty.
func jsonList[T any](v []T) any {
	if len(v) == 0 {
		return nil
	}
	b, _ := json.Marshal(v)
	return string(b)
}

func nullID(n int64) sql.NullInt64 { return sql.NullInt64{Int64: n, Valid: n != 0} }

func b2i(b bool) int64 {
	if b {
		return 1
	}
	return 0
}
