package imports

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
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
	// SkipNotOnTVDB: a Series TheTVDB does not know cannot be managed.
	SkipNotOnTVDB = "not_on_tvdb"
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
	// LeftUnmatched: the file names no episode TheTVDB lists for the Series.
	LeftUnmatched = "unmatched"
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
	// ErrBadMonitor means a monitoring choice is not all, future or none.
	ErrBadMonitor = errors.New("monitor is all, future or none")
)

// Summary counts the rows of a plan. Duplicate and Replacement count rows
// that also sit in Matched.
type Summary struct {
	Matched, NeedsChoice, Skipped, Duplicate, Replacement int
	// Adopting counts the rows a commit would adopt: Matched, ticked, with a
	// file that is not left in place.
	Adopting int
}

// CommitResult is what the last commit did.
type CommitResult struct {
	Adopted, Failed int
	// TitleIDs are the Titles the commit adopted.
	TitleIDs []int64
	// Outcomes counts the kept rows by how they ended.
	Outcomes Outcomes
}

// FinalOutcome is what became of a row after a commit; "" for a row of a plan
// that has not been committed.
type FinalOutcome string

// The final outcomes of a row.
const (
	// EndedAdopted: the row was committed and its files adopted.
	EndedAdopted FinalOutcome = "adopted"
	// EndedFailed: the row was committed and adopting it failed (see Row.Error).
	EndedFailed FinalOutcome = "failed"
	// EndedSkipped: the entry could not be adopted (see Row.SkipReason).
	EndedSkipped FinalOutcome = "skipped"
	// EndedNotChosen: a Needs choice row nobody settled.
	EndedNotChosen FinalOutcome = "not_chosen"
	// EndedUnticked: a Matched row that was left out.
	EndedUnticked FinalOutcome = "unticked"
)

// Outcomes counts rows by final outcome.
type Outcomes struct{ Adopted, Failed, Skipped, NotChosen, Unticked int }

// Current is the entry a running scan or commit is working on.
type Current struct {
	Entry string
	Step  Step
	// Files is how many files the step covers; 0 when it is not about files.
	Files int
	// Title names the Movie or Series the entry is adopted as, "Paddington
	// (2014)", once it is matched: a commit's; "" while a scan is still
	// looking for it.
	Title string
}

// Step is what a running scan or commit is doing to its current entry.
type Step string

// The steps of Current.
const (
	StepProbing  Step = "probing"
	StepMatching Step = "matching"
	StepMoving   Step = "moving"
)

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
	// Current is what a running scan or commit is working on; nil when none.
	Current *Current
	// Monitor is how the Titles the plan adds are monitored unless a row
	// says otherwise.
	Monitor library.Monitor
}

// Match is the Movie or Series a row's files are adopted as.
type Match struct {
	TMDBID int `json:"tmdb_id"`
	// TVDBID is the Series' TheTVDB id; 0 for a Movie.
	TVDBID int    `json:"tvdb_id,omitempty"`
	Title  string `json:"title"`
	Year   int    `json:"year"`
	// TitleID is the tracked Title the files join; 0 when adopting adds it.
	TitleID int64  `json:"title_id"`
	Source  string `json:"source"`
	// Folder is the Title folder (not a path) the files are renamed into.
	Folder string `json:"folder"`
}

// Candidate is a likely Movie for a Needs choice row. Candidates come best
// first: the first is Suggested, and Confident when a selection may accept it
// without a look (see adopt_rank.go).
type Candidate struct {
	TMDBID    int    `json:"tmdb_id"`
	Title     string `json:"title"`
	Year      int    `json:"year"`
	Suggested bool   `json:"suggested,omitempty"`
	Confident bool   `json:"confident,omitempty"`
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
	Left      string    `json:"left,omitempty"`
	Subtitles []PlanSub `json:"subtitles,omitempty"`
	// Episodes are the episodes of a Series file; empty for a Movie file.
	Episodes    []library.EpisodeRef `json:"episodes,omitempty"`
	Misfit      bool                 `json:"misfit"`
	ReleaseName string               `json:"release_name"`
	Parsed      json.RawMessage      `json:"parsed"`
	Probe       json.RawMessage      `json:"probe"`
}

// Row is one entry of a Root folder and what Adoption would do with it.
type Row struct {
	// Kind is the kind of Root folder the entry sits in; "" reads as a Movie.
	Kind       library.Kind `json:"kind"`
	ID         int64        `json:"-"`
	Status     RowStatus    `json:"-"`
	Ticked     bool         `json:"-"`
	SkipReason string       `json:"skip_reason,omitempty"`
	// Entry is the folder or loose file in the Root folder.
	Entry string `json:"entry"`
	// EntryRoot is the Root folder the entry sits in; Root is the one its
	// files are adopted into (a tracked Title's own).
	EntryRoot  string      `json:"entry_root"`
	Root       string      `json:"root"`
	Match      *Match      `json:"match,omitempty"`
	Candidates []Candidate `json:"candidates,omitempty"`
	Files      []PlanFile  `json:"files,omitempty"`
	// Probed are the probes of the files of a Needs choice row, kept until it
	// is settled.
	Probed []probedFile `json:"probed,omitempty"`
	// Outcome is what became of the row after a commit, and Error why a failed
	// row failed. Rows are kept with them until the next scan.
	Outcome FinalOutcome `json:"outcome,omitempty"`
	Error   string       `json:"error,omitempty"`
	// Monitor is the row's own choice of how the Title it adds is monitored;
	// "" follows the plan's. A tracked Title keeps its own monitoring.
	Monitor library.Monitor `json:"monitor,omitempty"`
}

// kind is the row's kind, a Movie when the plan was stored before Series.
func (r Row) kind() library.Kind {
	if r.Kind == "" {
		return library.Movie
	}
	return r.Kind
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
	AdoptSeries(ctx context.Context, a library.AdoptSeries) (int64, []library.File, error)
	Episodes(ctx context.Context, titleID int64, view library.View) ([]library.Episode, error)
}

// AdoptProfiles is what Adoption needs of the Profiles.
type AdoptProfiles interface {
	List(ctx context.Context) ([]profiles.Profile, error)
	Region(ctx context.Context) (profiles.Region, bool, error)
}

// AdoptMeta is what Adoption needs of the metadata provider.
type AdoptMeta interface {
	Search(ctx context.Context, query string) ([]metadata.SearchResult, error)
	Movie(ctx context.Context, id int) (metadata.MovieDetails, error)
	FindMovieByIMDb(ctx context.Context, imdbID string) (int, bool, error)
	Series(ctx context.Context, id int) (metadata.SeriesDetails, error)
	FindSeriesByIMDb(ctx context.Context, imdbID string) (int, bool, error)
	FindSeriesByTVDB(ctx context.Context, tvdbID int) (int, bool, error)
}

// AdoptionDeps are what an Adoption service needs.
type AdoptionDeps struct {
	Store    *store.Store
	Library  AdoptLibrary
	Profiles AdoptProfiles
	Meta     AdoptMeta
	TVDB     metadata.TVDBProvider
	Prober   probe.Prober
	Roots    *rootfolders.Service
	History  *history.Service
	Clock    func() time.Time
	Logger   *slog.Logger
	// Snapshot is the TRaSH data to score with; nil means the embedded one.
	Snapshot *scoring.Snapshot
	// Scoring is the live TRaSH snapshot; it wins over Snapshot.
	Scoring *scoring.Holder
	// Rescore, when set, re-scores a Title's files under the active TRaSH
	// snapshot and the settings of now; the plan holds the Scores of the scan.
	Rescore func(ctx context.Context, titleID int64) error
	// FolderChanged, when set, is told the Title folder an Adoption took over,
	// so the media servers can be asked to refresh it.
	FolderChanged func(ctx context.Context, folder string)
}

// rescored brings a just-adopted Title's stored Scores and misfit marks up to
// date: the plan was made at scan time, and the snapshot or the household's
// language may have changed since.
func (a *Adoption) rescored(ctx context.Context, titleID int64) {
	if a.d.Rescore == nil {
		return
	}
	if err := a.d.Rescore(ctx, titleID); err != nil {
		a.d.Logger.Warn("re-scoring an adopted Title failed", "title", titleID, "err", err)
	}
}

func (a *Adoption) folderChanged(ctx context.Context, folder string) {
	if a.d.FolderChanged != nil {
		a.d.FolderChanged(ctx, folder)
	}
}

// Adoption takes over an existing on-disk library: a manual scan builds one
// persisted plan, the admin reviews and edits it, and a commit adopts what is
// ticked. Nothing is written to the Library or the disk before the commit.
type Adoption struct {
	d    AdoptionDeps
	snap *scoring.Holder
	q    *db.Queries
	mu   sync.Mutex // serialises the plan's state changes and row edits
	wg   sync.WaitGroup
	cur  atomic.Pointer[Current] // what a running scan or commit works on, for Progress
}

// setCurrent says what the running scan or commit is working on.
func (a *Adoption) setCurrent(entry string, step Step, files int, title string) {
	a.cur.Store(&Current{Entry: entry, Step: step, Files: files, Title: title})
}

// working says what a scan, a Try again or a commit is doing; an edit that
// plans a row by hand (e.running is false) runs outside any of them and says
// nothing.
func (a *Adoption) working(e *env, entry string, step Step, files int) {
	if e.running {
		a.setCurrent(entry, step, files, "")
	}
}

func (a *Adoption) clearCurrent() { a.cur.Store(nil) }

// NewAdoption returns the service. A scan or commit that a restart cut short
// is undone: the scan's plan is dropped, the commit's rows stay for review, and
// the rows a Try again was planning again stay as the commit left them.
func NewAdoption(d AdoptionDeps) (*Adoption, error) {
	if d.Clock == nil {
		d.Clock = time.Now
	}
	if d.Logger == nil {
		d.Logger = slog.Default()
	}
	snap := d.Scoring
	if snap == nil {
		one := d.Snapshot
		if one == nil {
			var err error
			if one, err = scoring.Embedded(); err != nil {
				return nil, err
			}
		}
		snap = scoring.NewHolder(one)
	}
	a := &Adoption{d: d, snap: snap, q: db.New(d.Store.Write())}
	ctx := context.Background()
	p, err := a.q.GetAdoptionPlan(ctx)
	if err != nil {
		return nil, err
	}
	switch PlanState(p.State) {
	case PlanScanning:
		// A scan clears the last commit's result and a Try again keeps it, which
		// tells them apart: the rows a Try again was planning again are the ones
		// the commit kept, with their choices, and stay.
		if p.Adopted.Valid {
			err = a.q.FailAdoptionScan(ctx, sql.NullString{String: "Try again was interrupted by a restart", Valid: true})
			break
		}
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
	out := Plan{State: PlanState(p.State), Revision: p.Revision, Done: int(p.Done), Total: int(p.Total), Error: p.Error.String, Monitor: library.Monitor(p.Monitor)}
	if p.ScannedAt.Valid {
		if t, err := time.Parse(time.RFC3339, p.ScannedAt.String); err == nil {
			out.ScannedAt = &t
		}
	}
	if p.Adopted.Valid {
		out.Result = &CommitResult{Adopted: int(p.Adopted.Int64), Failed: int(p.Failed.Int64), TitleIDs: []int64{}}
		if p.AdoptedTitles.Valid {
			_ = json.Unmarshal([]byte(p.AdoptedTitles.String), &out.Result.TitleIDs)
		}
	}
	rows, err := a.rows(ctx)
	if err != nil {
		return Plan{}, err
	}
	out.Summary = summarizeRows(planRows(rows))
	if out.Result != nil {
		out.Result.Outcomes = countOutcomes(rows)
	}
	if out.State == PlanScanning || out.State == PlanCommitting {
		out.Current = a.cur.Load()
	}
	return out, nil
}

// planRows are the rows of a plan under review, not those a commit kept.
func planRows(rows []Row) []Row {
	out := make([]Row, 0, len(rows))
	for _, r := range rows {
		if r.Outcome == "" {
			out = append(out, r)
		}
	}
	return out
}

func countOutcomes(rows []Row) Outcomes {
	var o Outcomes
	for _, r := range rows {
		switch r.Outcome {
		case EndedAdopted:
			o.Adopted++
		case EndedFailed:
			o.Failed++
		case EndedSkipped:
			o.Skipped++
		case EndedNotChosen:
			o.NotChosen++
		case EndedUnticked:
			o.Unticked++
		}
	}
	return o
}

// Progress is the plan's state and how far a scan or commit has got.
type Progress struct {
	State       PlanState
	Done, Total int
	// Current is what the running scan or commit works on; nil when none runs.
	Current *Current
}

// Progress reads the plan's state and progress without its rows: cheap enough
// for the stream to read on every tick.
func (a *Adoption) Progress(ctx context.Context) (Progress, error) {
	p, err := db.New(a.d.Store.Read()).GetAdoptionPlan(ctx)
	if err != nil {
		return Progress{}, err
	}
	out := Progress{State: PlanState(p.State), Done: int(p.Done), Total: int(p.Total)}
	if out.State == PlanScanning || out.State == PlanCommitting {
		out.Current = a.cur.Load()
	}
	return out, nil
}

func summarizeRows(rows []Row) Summary {
	var s Summary
	for _, r := range rows {
		switch r.Status {
		case Matched:
			s.Matched++
			if r.willAdopt() {
				s.Adopting++
			}
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

// willAdopt reports whether a commit would adopt the row: a row of the plan
// under review (a kept row has been through a commit already).
func (r Row) willAdopt() bool {
	return r.Outcome == "" && r.Status == Matched && r.Ticked && r.has(PlanFile.adopts)
}

// countFiles counts the row's files the predicate holds for.
func (r Row) countFiles(pred func(PlanFile) bool) int {
	n := 0
	for _, f := range r.Files {
		if pred(f) {
			n++
		}
	}
	return n
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

// keeps reports whether the row is one the filter keeps.
func (f Filter) keeps(r Row) bool {
	switch f {
	case FilterNeedsChoice, FilterMatched, FilterSkipped:
		return string(r.Status) == string(f)
	case FilterDuplicate:
		return r.has(func(f PlanFile) bool { return f.Left == LeftDuplicate })
	case FilterReplacement:
		return r.has(func(f PlanFile) bool { return f.Action == ActionReplace && f.Left == "" })
	}
	return true
}

// grouped orders rows Matched first, then Needs choice, then Skipped, each
// group in the order of the scan.
func grouped(all []Row) []Row {
	out := make([]Row, 0, len(all))
	for _, status := range []RowStatus{Matched, NeedsChoice, Skipped} {
		for _, r := range all {
			if r.Status == status {
				out = append(out, r)
			}
		}
	}
	return out
}

// RowPage is one page of the plan's rows.
type RowPage struct {
	Rows []Row
	// Total is how many rows the filter keeps, over all pages.
	Total int
	// Summary counts the whole plan, whatever the filter.
	Summary Summary
}

// Rows returns the rows the filter and the final outcome keep, Matched first,
// then Needs choice, then Skipped, from offset on and at most limit of them (0
// is no limit).
// An outcome of "" asks for the rows of the plan under review, not the rows a
// commit kept.
func (a *Adoption) Rows(ctx context.Context, f Filter, o FinalOutcome, offset, limit int) (RowPage, error) {
	all, err := a.rows(ctx)
	if err != nil {
		return RowPage{}, err
	}
	page := RowPage{Summary: summarizeRows(planRows(all))}
	var kept []Row
	for _, r := range grouped(all) {
		if f.keeps(r) && o == r.Outcome {
			kept = append(kept, r)
		}
	}
	page.Total = len(kept)
	offset = min(max(offset, 0), len(kept))
	end := len(kept)
	if limit > 0 {
		end = min(offset+limit, end)
	}
	page.Rows = kept[offset:end]
	return page, nil
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
	if err := a.q.ResetAdoption(ctx); err != nil {
		return err
	}
	return a.q.SetAdoptionMonitor(ctx, string(library.MonitorAll))
}
