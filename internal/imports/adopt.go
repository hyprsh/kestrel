package imports

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/imports/db"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/probe"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
	"github.com/hyprsh/kestrel/internal/settings/rootfolders"
	"github.com/hyprsh/kestrel/internal/store"
)

// PlanState is where the Adoption plan stands.
type PlanState string

const (
	// PlanIdle: there is no plan.
	PlanIdle PlanState = "idle"
	// PlanScanning: a scan is building the plan in the background.
	PlanScanning PlanState = "scanning"
	// PlanPlanned: the plan waits for review.
	PlanPlanned PlanState = "planned"
	// PlanCommitting: the ticked rows are being adopted in the background.
	PlanCommitting PlanState = "committing"
)

// RowStatus groups the rows of a plan.
type RowStatus string

const (
	// Matched: the entry is a known Movie and its files are ready to adopt.
	Matched RowStatus = "matched"
	// NeedsChoice: the match is not certain; the admin picks one.
	NeedsChoice RowStatus = "needs_choice"
	// Skipped: the entry cannot be adopted (see SkipReason).
	Skipped RowStatus = "skipped"
)

// Why a row is skipped.
const (
	SkipInvalid          = "invalid"
	SkipNoVideo          = "no_video"
	SkipNoEnabledProfile = "no_enabled_profile"
)

// How a file joins its Title.
const (
	ActionCreate  = "create"  // the Version is new
	ActionFill    = "fill"    // the Version exists and is empty
	ActionReplace = "replace" // the Version holds a file this one would replace
)

// Why a file is left where it is.
const (
	LeftDuplicate    = "duplicate"
	LeftPathOccupied = "path_occupied"
)

// How a row was matched.
const (
	SourceTag    = "tag"
	SourceName   = "name"
	SourceChosen = "chosen"
)

// Errors of the Adoption service.
var (
	// ErrBusy means a scan or a commit is running.
	ErrBusy = errors.New("an Adoption scan or commit is running")
	// ErrStale means the plan changed since the revision the caller reviewed,
	// or is not waiting for a commit.
	ErrStale = errors.New("the Adoption plan changed")
	// ErrNoRow means the plan has no such row.
	ErrNoRow = errors.New("no such Adoption row")
	// ErrNoRoot means a named Root folder is not one of the configured ones.
	ErrNoRoot = errors.New("not a configured Root folder")
	// ErrNotSettleable means the row cannot be matched to the Movie asked for.
	ErrNotSettleable = errors.New("the row cannot be matched to that Movie")
)

// Summary counts the rows of a plan. Duplicate and Replacement count rows
// that also sit in Matched.
type Summary struct {
	Matched, NeedsChoice, Skipped, Duplicate, Replacement int
}

// CommitResult is what the last commit did.
type CommitResult struct {
	Adopted, Failed int
}

// Plan is the Adoption plan's state.
type Plan struct {
	State    PlanState
	Revision int64
	Done     int
	Total    int
	// Error is why the last scan could not finish.
	Error     string
	ScannedAt *time.Time
	Summary   Summary
	Result    *CommitResult
}

// Match is the Movie a row's files are adopted as.
type Match struct {
	TMDBID int    `json:"tmdb_id"`
	Title  string `json:"title"`
	Year   int    `json:"year"`
	// TitleID is the tracked Title the files join; 0 when adopting adds it.
	TitleID int64  `json:"title_id"`
	Source  string `json:"source"`
	// Folder is the Title folder (not a path) the files are renamed into.
	Folder string `json:"folder"`
}

// Candidate is a likely Movie for a Needs choice row.
type Candidate struct {
	TMDBID int    `json:"tmdb_id"`
	Title  string `json:"title"`
	Year   int    `json:"year"`
}

// PlanSub is a sidecar subtitle that moves with its video.
type PlanSub struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// PlanFile is one video file of a row and what adopting it does.
type PlanFile struct {
	Path string `json:"path"`
	// To is the full path the file gets in the naming scheme.
	To      string `json:"to"`
	Size    int64  `json:"size"`
	Slot    Slot   `json:"slot"`
	Profile string `json:"profile"`
	Score   int    `json:"score"`
	Action  string `json:"action"`
	// HeldScore is the Score of the file ActionReplace would replace.
	HeldScore *int `json:"held_score,omitempty"`
	Ticked    bool `json:"ticked"`
	// Left says why the file is not adopted whatever is ticked; "" when it is.
	Left        string          `json:"left,omitempty"`
	Subtitles   []PlanSub       `json:"subtitles,omitempty"`
	ReleaseName string          `json:"release_name"`
	Parsed      json.RawMessage `json:"parsed"`
	Probe       json.RawMessage `json:"probe"`
}

// Row is one entry of a Root folder and what Adoption would do with it.
type Row struct {
	ID         int64     `json:"-"`
	Status     RowStatus `json:"-"`
	Ticked     bool      `json:"-"`
	SkipReason string    `json:"skip_reason,omitempty"`
	// Entry is the folder or loose file in the Root folder.
	Entry string `json:"entry"`
	// EntryRoot is the Root folder the entry sits in; Root is the one its
	// files are adopted into (a tracked Title's own).
	EntryRoot  string      `json:"entry_root"`
	Root       string      `json:"root"`
	Match      *Match      `json:"match,omitempty"`
	Candidates []Candidate `json:"candidates,omitempty"`
	Files      []PlanFile  `json:"files,omitempty"`
}

// adopts reports whether the file would be adopted if its row is ticked.
func (f PlanFile) adopts() bool { return f.Ticked && f.Left == "" }

// AdoptLibrary is what Adoption needs of the library module.
type AdoptLibrary interface {
	Tracked(ctx context.Context) ([]library.Tracked, error)
	HeldPaths(ctx context.Context) (map[string]bool, error)
	Get(ctx context.Context, id int64, view library.View) (library.Detail, error)
	Find(ctx context.Context, kind library.Kind, tmdbID, tvdbID int) (int64, bool, error)
	AdoptMovie(ctx context.Context, a library.AdoptMovie) (int64, []library.File, error)
}

// AdoptProfiles is what Adoption needs of the Profiles.
type AdoptProfiles interface {
	List(ctx context.Context) ([]profiles.Profile, error)
	Region(ctx context.Context) (profiles.Region, bool, error)
	Kids(ctx context.Context) (profiles.KidsRule, bool, error)
}

// AdoptMeta is what Adoption needs of the metadata provider.
type AdoptMeta interface {
	Search(ctx context.Context, query string) ([]metadata.SearchResult, error)
	Movie(ctx context.Context, id int) (metadata.MovieDetails, error)
	FindMovieByIMDb(ctx context.Context, imdbID string) (int, bool, error)
}

// AdoptionDeps are what an Adoption service needs.
type AdoptionDeps struct {
	Store    *store.Store
	Library  AdoptLibrary
	Profiles AdoptProfiles
	Meta     AdoptMeta
	Prober   probe.Prober
	Roots    *rootfolders.Service
	History  *history.Service
	Clock    func() time.Time
	Logger   *slog.Logger
	// Snapshot is the TRaSH data to score with; nil means the embedded one.
	Snapshot *scoring.Snapshot
}

// Adoption takes over an existing on-disk library: a manual scan builds one
// persisted plan, the admin reviews and edits it, and a commit adopts what is
// ticked. Nothing is written to the Library or the disk before the commit.
type Adoption struct {
	d    AdoptionDeps
	snap *scoring.Snapshot
	q    *db.Queries
	mu   sync.Mutex // serialises the plan's state changes and row edits
	wg   sync.WaitGroup
}

// NewAdoption returns the service. A scan or commit that a restart cut short
// is undone: the scan's plan is dropped, the commit's rows stay for review.
func NewAdoption(d AdoptionDeps) (*Adoption, error) {
	if d.Clock == nil {
		d.Clock = time.Now
	}
	if d.Logger == nil {
		d.Logger = slog.Default()
	}
	snap := d.Snapshot
	if snap == nil {
		var err error
		if snap, err = scoring.Embedded(); err != nil {
			return nil, err
		}
	}
	a := &Adoption{d: d, snap: snap, q: db.New(d.Store.Write())}
	ctx := context.Background()
	p, err := a.q.GetAdoptionPlan(ctx)
	if err != nil {
		return nil, err
	}
	switch PlanState(p.State) {
	case PlanScanning:
		if err := a.q.DeleteAdoptionRows(ctx); err != nil {
			return nil, err
		}
		err = a.q.FailAdoptionScan(ctx, sql.NullString{String: "the scan was interrupted by a restart", Valid: true})
	case PlanCommitting:
		err = a.q.SetAdoptionState(ctx, db.SetAdoptionStateParams{State: string(PlanPlanned)})
	}
	if err != nil {
		return nil, err
	}
	return a, nil
}

// Wait blocks until the background scan or commit, if any, has finished.
func (a *Adoption) Wait() { a.wg.Wait() }

// Get returns the plan's state.
func (a *Adoption) Get(ctx context.Context) (Plan, error) {
	p, err := db.New(a.d.Store.Read()).GetAdoptionPlan(ctx)
	if err != nil {
		return Plan{}, err
	}
	out := Plan{State: PlanState(p.State), Revision: p.Revision, Done: int(p.Done), Total: int(p.Total), Error: p.Error.String}
	if p.ScannedAt.Valid {
		if t, err := time.Parse(time.RFC3339, p.ScannedAt.String); err == nil {
			out.ScannedAt = &t
		}
	}
	if p.Adopted.Valid {
		out.Result = &CommitResult{Adopted: int(p.Adopted.Int64), Failed: int(p.Failed.Int64)}
	}
	rows, err := a.rows(ctx)
	if err != nil {
		return Plan{}, err
	}
	out.Summary = summarizeRows(rows)
	return out, nil
}

func summarizeRows(rows []Row) Summary {
	var s Summary
	for _, r := range rows {
		switch r.Status {
		case Matched:
			s.Matched++
		case NeedsChoice:
			s.NeedsChoice++
		case Skipped:
			s.Skipped++
		}
		if r.has(func(f PlanFile) bool { return f.Left == LeftDuplicate }) {
			s.Duplicate++
		}
		if r.has(func(f PlanFile) bool { return f.Action == ActionReplace && f.Left == "" }) {
			s.Replacement++
		}
	}
	return s
}

func (r Row) has(pred func(PlanFile) bool) bool {
	for _, f := range r.Files {
		if pred(f) {
			return true
		}
	}
	return false
}

// Filter narrows Rows.
type Filter string

// The filters of Rows; "" keeps every row.
const (
	FilterNeedsChoice Filter = "needs_choice"
	FilterMatched     Filter = "matched"
	FilterDuplicate   Filter = "duplicate"
	FilterReplacement Filter = "replacement"
	FilterSkipped     Filter = "skipped"
)

// Rows returns the plan's rows, Matched first, then Needs choice, then Skipped.
func (a *Adoption) Rows(ctx context.Context, f Filter) ([]Row, error) {
	all, err := a.rows(ctx)
	if err != nil {
		return nil, err
	}
	var out []Row
	for _, status := range []RowStatus{Matched, NeedsChoice, Skipped} {
		for _, r := range all {
			if r.Status != status {
				continue
			}
			switch f {
			case FilterNeedsChoice, FilterMatched, FilterSkipped:
				if string(r.Status) != string(f) {
					continue
				}
			case FilterDuplicate:
				if !r.has(func(f PlanFile) bool { return f.Left == LeftDuplicate }) {
					continue
				}
			case FilterReplacement:
				if !r.has(func(f PlanFile) bool { return f.Action == ActionReplace && f.Left == "" }) {
					continue
				}
			}
			out = append(out, r)
		}
	}
	return out, nil
}

func (a *Adoption) rows(ctx context.Context) ([]Row, error) {
	recs, err := db.New(a.d.Store.Read()).ListAdoptionRows(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Row, 0, len(recs))
	for _, rec := range recs {
		r, err := rowOf(rec)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, nil
}

func rowOf(rec db.AdoptionRow) (Row, error) {
	var r Row
	if err := json.Unmarshal([]byte(rec.Data), &r); err != nil {
		return Row{}, fmt.Errorf("imports: read Adoption row %d: %w", rec.ID, err)
	}
	r.ID, r.Status, r.Ticked = rec.ID, RowStatus(rec.Status), rec.Ticked == 1
	return r, nil
}

func b2i(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

// Discard throws the plan away. Nothing a plan holds was written anywhere.
func (a *Adoption) Discard(ctx context.Context) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	p, err := a.q.GetAdoptionPlan(ctx)
	if err != nil {
		return err
	}
	if PlanState(p.State) == PlanCommitting || PlanState(p.State) == PlanScanning {
		return ErrBusy
	}
	if err := a.q.DeleteAdoptionRows(ctx); err != nil {
		return err
	}
	return a.q.ResetAdoption(ctx)
}
