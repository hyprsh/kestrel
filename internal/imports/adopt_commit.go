package imports

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/imports/db"
	"github.com/hyprsh/kestrel/internal/library"
)

// RowPatch edits a row. Nil and empty fields stay.
type RowPatch struct {
	// Ticked includes or leaves out the whole row.
	Ticked *bool
	// TMDBID settles a Needs choice row or corrects a match: the row is
	// planned again against that Movie.
	TMDBID *int
	// Files ticks or unticks single files by path.
	Files []FileTick
	// Monitor is the row's own choice of how the Title it adds is monitored.
	Monitor *library.Monitor
}

// FileTick is one file's tick.
type FileTick struct {
	Path   string
	Ticked bool
}

// guard reads the plan for a change of it: ErrBusy while a scan or a commit
// runs, and whenIdle or whenPlanned (nil lets the change go on) when the plan
// is in that state.
func (a *Adoption) guard(ctx context.Context, whenIdle, whenPlanned error) (db.AdoptionPlan, error) {
	plan, err := a.q.GetAdoptionPlan(ctx)
	if err != nil {
		return plan, err
	}
	switch PlanState(plan.State) {
	case PlanScanning, PlanCommitting:
		return plan, ErrBusy
	case PlanIdle:
		return plan, whenIdle
	}
	return plan, whenPlanned
}

// editable is the plan's stored rows, read for an edit: ErrBusy while a scan
// or a commit runs, ErrNoRow when there is no plan.
func (a *Adoption) editable(ctx context.Context) ([]db.AdoptionRow, []Row, error) {
	if _, err := a.guard(ctx, ErrNoRow, nil); err != nil {
		return nil, nil, err
	}
	recs, err := a.q.ListAdoptionRows(ctx)
	if err != nil {
		return nil, nil, err
	}
	rows := make([]Row, len(recs))
	for i, rec := range recs {
		if rows[i], err = rowOf(rec); err != nil {
			return nil, nil, err
		}
	}
	return recs, rows, nil
}

// saveEdit settles the rows (an edit can flip another row's files to or from
// duplicate), writes every row that differs from what was read, and moves the
// plan's revision once.
func (a *Adoption) saveEdit(ctx context.Context, recs []db.AdoptionRow, rows []Row) error {
	settle(rows)
	for i := range rows {
		data, err := json.Marshal(rows[i])
		if err != nil {
			return err
		}
		if string(data) == recs[i].Data && b2i(rows[i].Ticked) == recs[i].Ticked && string(rows[i].Status) == recs[i].Status {
			continue
		}
		if err := a.q.UpdateAdoptionRow(ctx, db.UpdateAdoptionRowParams{
			Status: string(rows[i].Status), Ticked: b2i(rows[i].Ticked), Data: string(data), ID: rows[i].ID,
		}); err != nil {
			return err
		}
	}
	return a.q.BumpAdoptionRevision(ctx)
}

// replan plans the row again against the Movie or Series chosen, as choosing
// it by hand does and as accepting a suggestion does. The row may come back
// Skipped (no enabled Profile, say): it is stored as that, with its reason.
func (a *Adoption) replan(ctx context.Context, e *env, row *Row, tmdbID int) error {
	st, err := os.Stat(row.Entry)
	if err != nil {
		return ErrNotSettleable
	}
	en := entry{Kind: row.kind(), Root: row.EntryRoot, Path: row.Entry, Name: filepath.Base(row.Entry), IsDir: st.IsDir(), Probed: row.Probed}
	if !en.IsDir {
		en.Name = strings.TrimSuffix(en.Name, filepath.Ext(en.Name))
	}
	planned, err := a.planEntry(ctx, e, en, tmdbID)
	if err != nil {
		return err
	}
	if planned == nil || (planned.Status != Matched && planned.Status != Skipped) {
		return ErrNotSettleable
	}
	planned.ID, planned.Monitor = row.ID, row.Monitor
	*row = *planned
	return nil
}

// PatchRow applies an edit to a row of the plan and returns the row as it is
// afterwards. Every edit moves the plan's revision.
func (a *Adoption) PatchRow(ctx context.Context, id int64, p RowPatch) (Row, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	recs, rows, err := a.editable(ctx)
	if err != nil {
		return Row{}, err
	}
	at := slices.IndexFunc(rows, func(r Row) bool { return r.ID == id })
	if at < 0 || rows[at].Outcome != "" { // a kept row is not under review
		return Row{}, ErrNoRow
	}
	row := &rows[at]
	if p.TMDBID != nil {
		e, err := a.env(ctx)
		if err != nil {
			return Row{}, err
		}
		if err := a.replan(ctx, e, row, *p.TMDBID); err != nil {
			return Row{}, err
		}
	}
	if p.Monitor != nil {
		if !p.Monitor.Valid() {
			return Row{}, ErrBadMonitor
		}
		row.Monitor = *p.Monitor
	}
	if p.Ticked != nil {
		row.Ticked = *p.Ticked
	}
	for _, t := range p.Files {
		for i := range row.Files {
			if row.Files[i].Path == t.Path {
				row.Files[i].Ticked = t.Ticked
			}
		}
	}
	if err := a.saveEdit(ctx, recs, rows); err != nil {
		return Row{}, err
	}
	return rows[at], nil
}

// SetMonitor sets how the Titles the plan adds are monitored, unless a row
// says otherwise. It moves the plan's revision.
func (a *Adoption) SetMonitor(ctx context.Context, m library.Monitor) error {
	if !m.Valid() {
		return ErrBadMonitor
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, _, err := a.editable(ctx); err != nil {
		return err
	}
	return a.q.SetAdoptionMonitor(ctx, string(m))
}

// Commit adopts the ticked rows in the background, one transaction per Title.
// revision is the plan's revision the caller reviewed; a plan that changed
// since is ErrStale. A non-empty monitor first replaces the plan's choice of
// how the Titles it adds are monitored.
func (a *Adoption) Commit(ctx context.Context, revision int64, monitor library.Monitor) error {
	if monitor != "" && !monitor.Valid() {
		return ErrBadMonitor
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	plan, err := a.guard(ctx, ErrStale, nil)
	if err != nil {
		return err
	}
	if plan.Revision != revision {
		return ErrStale
	}
	chosen := library.Monitor(plan.Monitor)
	if monitor != "" {
		chosen = monitor
		if err := a.q.SetAdoptionMonitor(ctx, string(chosen)); err != nil {
			return err
		}
	}
	rows, err := a.rows(ctx)
	if err != nil {
		return err
	}
	prev := CommitResult{TitleIDs: []int64{}}
	if plan.AdoptedTitles.Valid {
		_ = json.Unmarshal([]byte(plan.AdoptedTitles.String), &prev.TitleIDs)
	}
	var todo []Row
	for i, r := range rows {
		if r.willAdopt() {
			if r.Monitor == "" {
				rows[i].Monitor = chosen // kept with the row, so a retry adopts it the same way
			}
			todo = append(todo, rows[i])
		}
	}
	if err := a.q.StartAdoptionCommit(ctx, int64(len(todo))); err != nil {
		return err
	}
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		a.runCommit(context.WithoutCancel(ctx), rows, todo, prev)
	}()
	return nil
}

// runCommit adopts the todo rows (a subset of rows) and then keeps every row
// with what became of it. prev is the result of the commits before it, which
// this one adds to.
func (a *Adoption) runCommit(ctx context.Context, rows, todo []Row, prev CommitResult) {
	defer a.snap.Hold()() // no TRaSH update lands between a row's Scores and the re-score after it
	titles := slices.Clone(prev.TitleIDs)
	ended := map[int64]ending{}
	e, err := a.env(ctx)
	if err != nil {
		a.d.Logger.Error("adoption commit failed", "err", err)
		for _, row := range todo {
			ended[row.ID] = ending{EndedFailed, errorText(err)}
		}
		todo = nil
	} else {
		e.running = true
	}
	total := int64(len(todo))
	for i, row := range todo {
		a.setCurrent(row.Entry, StepMoving, row.countFiles(PlanFile.adopts), titleOf(row))
		if err := a.adoptRow(ctx, e, row); err != nil {
			a.d.Logger.Error("adoption of an entry failed", "entry", row.Entry, "err", err)
			ended[row.ID] = ending{EndedFailed, errorText(err)}
		} else {
			ended[row.ID] = ending{Outcome: EndedAdopted}
			if id, ok, err := a.d.Library.Find(ctx, row.kind(), row.Match.TMDBID, row.Match.TVDBID); err == nil && ok {
				titles = append(titles, id)
			}
		}
		_ = a.q.SetAdoptionProgress(ctx, db.SetAdoptionProgressParams{Done: int64(i + 1), Total: total})
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.clearCurrent() // before the plan is let go, or it could wipe what a scan that starts next works on
	final := keptRows(rows, ended)
	if err := a.writeRows(ctx, final); err != nil {
		// All or nothing: rows some of which carry an outcome and some none
		// would read as a plan to review, so none are kept.
		a.d.Logger.Error("adoption: keeping the rows failed", "err", err)
		_ = a.q.DeleteAdoptionRows(ctx)
	}
	o := countOutcomes(final)
	stored, _ := json.Marshal(append([]int64{}, titles...))
	_ = a.q.FinishAdoptionCommit(ctx, db.FinishAdoptionCommitParams{
		Adopted: sql.NullInt64{Int64: int64(o.Adopted), Valid: true}, Failed: sql.NullInt64{Int64: int64(o.Failed), Valid: true},
		AdoptedTitles: sql.NullString{String: string(stored), Valid: true},
	})
}

// titleOf names the Title a row is adopted as, "Paddington (2014)".
func titleOf(r Row) string {
	if r.Match == nil {
		return ""
	}
	return fmt.Sprintf("%s (%d)", r.Match.Title, r.Match.Year)
}

// ending is how a row the commit tried ended: its final outcome and, for a
// failed row, why.
type ending struct {
	Outcome FinalOutcome
	Error   string
}

// keptRows is every row with its final outcome: adopted or failed as the
// commit says, and the rows it did not try as skipped, not chosen or unticked.
// A row an earlier commit kept keeps what it had.
func keptRows(rows []Row, ended map[int64]ending) []Row {
	out := make([]Row, len(rows))
	for i, r := range rows {
		if r.Outcome == "" {
			end, ok := ended[r.ID]
			if !ok {
				switch r.Status {
				case Skipped:
					end.Outcome = EndedSkipped
				case NeedsChoice:
					end.Outcome = EndedNotChosen
				default:
					end.Outcome = EndedUnticked
				}
			}
			r.Outcome, r.Error = end.Outcome, end.Error
		}
		out[i] = r
	}
	return out
}

// writeRows stores the rows in one transaction, all or none.
func (a *Adoption) writeRows(ctx context.Context, rows []Row) error {
	tx, err := a.d.Store.Write().BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := updateRows(ctx, db.New(tx), rows); err != nil {
		return err
	}
	return tx.Commit()
}

func updateRows(ctx context.Context, q *db.Queries, rows []Row) error {
	for _, r := range rows {
		data, err := json.Marshal(r)
		if err == nil {
			err = q.UpdateAdoptionRow(ctx, db.UpdateAdoptionRowParams{Status: string(r.Status), Ticked: b2i(r.Ticked), Data: string(data), ID: r.ID})
		}
		if err != nil {
			return fmt.Errorf("keep the row of %s: %w", r.Entry, err)
		}
	}
	return nil
}

// Errors of Try again and Reopen.
var (
	// ErrNothingToRetry means no row of the last commit failed.
	ErrNothingToRetry = errors.New("no Adoption entry failed")
	// ErrNothingToReopen means no row of the last commit was left Not chosen.
	ErrNothingToReopen = errors.New("no Adoption entry was left without a choice")
)

// kept returns the rows a commit kept that ended as outcome.
func (a *Adoption) kept(ctx context.Context, outcome FinalOutcome) ([]Row, error) {
	rows, err := a.rows(ctx)
	if err != nil {
		return nil, err
	}
	var out []Row
	for _, r := range rows {
		if r.Outcome == outcome {
			out = append(out, r)
		}
	}
	return out, nil
}

// Retry plans the failed entries of the last commit again, in the background
// and without a new scan, and puts them back in the plan for review. The other
// rows the commit kept and its result stay, and the next commit adds to them.
func (a *Adoption) Retry(ctx context.Context) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, err := a.guard(ctx, nil, ErrNothingToRetry); err != nil {
		return err
	}
	all, err := a.kept(ctx, EndedFailed)
	if err != nil {
		return err
	}
	var failed []Row
	for _, r := range all {
		if r.Match != nil {
			failed = append(failed, r)
		}
	}
	if len(failed) == 0 {
		return ErrNothingToRetry
	}
	if err := a.q.ReopenAdoptionRun(ctx, int64(len(failed))); err != nil {
		return err
	}
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		a.runRetry(context.WithoutCancel(ctx), failed)
	}()
	return nil
}

func (a *Adoption) runRetry(ctx context.Context, failed []Row) {
	planned, gone, err := a.replanFailed(ctx, failed)
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.finishRun(ctx, "adoption Try again", err, func() error {
		settle(planned)
		return a.writeRows(ctx, append(planned, gone...))
	}) {
		return
	}
	a.d.History.Record(ctx, history.Event{
		Kind: history.AdoptionScanned, Message: fmt.Sprintf("Adoption Try again: %d planned again, %d gone", len(planned), len(gone)),
	})
}

// replanFailed plans each failed row again against the Title it was matched
// to. An entry whose folder is gone stays failed, with that as its error.
func (a *Adoption) replanFailed(ctx context.Context, failed []Row) (planned, gone []Row, err error) {
	e, err := a.env(ctx)
	if err != nil {
		return nil, nil, err
	}
	e.running = true
	_ = a.q.SetAdoptionProgress(ctx, db.SetAdoptionProgressParams{Done: 0, Total: int64(len(failed))})
	for i, row := range failed {
		was := row
		row.Outcome, row.Error = "", ""
		switch err := a.replan(ctx, e, &row, row.Match.TMDBID); {
		case errors.Is(err, ErrNotSettleable):
			a.d.Logger.Warn("adoption Try again: the entry is gone", "entry", row.Entry)
			was.Error = "The entry is gone, or can no longer be matched to its Title"
			gone = append(gone, was)
		case err != nil:
			return nil, nil, err
		default:
			planned = append(planned, row)
		}
		_ = a.q.SetAdoptionProgress(ctx, db.SetAdoptionProgressParams{Done: int64(i + 1), Total: int64(len(failed))})
	}
	return planned, gone, nil
}

// Reopen puts the rows a commit left Not chosen back in the plan as Needs
// choice, without a scan, so the admin can settle them and commit again. The
// other rows the commit kept and its result stay.
func (a *Adoption) Reopen(ctx context.Context) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, err := a.guard(ctx, nil, ErrNothingToReopen); err != nil {
		return err
	}
	open, err := a.kept(ctx, EndedNotChosen)
	if err != nil {
		return err
	}
	if len(open) == 0 {
		return ErrNothingToReopen
	}
	for i := range open {
		open[i].Outcome, open[i].Error = "", ""
	}
	tx, err := a.d.Store.Write().BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	q := db.New(tx)
	if err := updateRows(ctx, q, open); err != nil {
		return err
	}
	if err := q.SetAdoptionState(ctx, db.SetAdoptionStateParams{State: string(PlanPlanned)}); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	a.d.History.Record(ctx, history.Event{
		Kind: history.AdoptionScanned, Message: fmt.Sprintf("Adoption reopened %d entries without a choice", len(open)),
	})
	return nil
}

// move is one rename done on disk, kept to undo it.
type move struct{ from, to string }

// adoptRow renames a row's ticked files into the scheme and writes the
// Title's Versions in one transaction. If the transaction fails, every
// rename is undone, so each Title either happened or did not.
func (a *Adoption) adoptRow(ctx context.Context, e *env, row Row) (err error) {
	if row.kind() == library.Series {
		return a.adoptSeriesRow(ctx, e, row)
	}
	m := row.Match
	// The Title may have been added since the scan, by an earlier row or the admin.
	titleID, tracked, err := a.d.Library.Find(ctx, library.Movie, m.TMDBID, 0)
	if err != nil {
		return err
	}
	dir := filepath.Join(row.Root, m.Folder)
	root := row.Root
	var folder string
	if tracked {
		d, err := a.d.Library.Get(ctx, titleID, library.View{Country: e.region.Country, Now: a.d.Clock()})
		if err != nil {
			return err
		}
		root, folder = d.RootFolder, d.Folder
		if d.Folder != "" {
			dir = filepath.Join(d.RootFolder, d.Folder)
		}
	}
	if folder == "" {
		folder = m.Folder
	}

	var done []move
	undo := func() {
		for i := len(done) - 1; i >= 0; i-- {
			_ = os.Rename(done[i].to, done[i].from)
		}
	}
	defer func() {
		if err != nil {
			undo()
		}
	}()

	var versions []library.AdoptVersion
	var moved []PlanFile
	for _, f := range row.Files {
		if !f.adopts() {
			continue
		}
		f = rehome(f, dir)
		if _, serr := os.Lstat(f.Path); serr != nil {
			continue // the file is gone since the scan
		}
		if f.Path != f.To {
			if exists(f.To) {
				continue // something took the name since the scan
			}
			if err = os.MkdirAll(filepath.Dir(f.To), 0o777); err != nil {
				return err
			}
			if err = os.Rename(f.Path, f.To); err != nil {
				return err
			}
			done = append(done, move{f.Path, f.To})
		}
		for _, s := range f.Subtitles {
			if s.From == s.To || exists(s.To) {
				continue
			}
			if _, serr := os.Lstat(s.From); serr != nil {
				continue
			}
			if err = os.Rename(s.From, s.To); err != nil {
				return err
			}
			done = append(done, move{s.From, s.To})
		}
		moved = append(moved, f)
		versions = append(versions, library.AdoptVersion{
			Slot: f.Slot, Profile: f.Profile, Replace: f.Action == ActionReplace,
			File: library.NewFile{
				Path: f.To, Size: f.Size, ReleaseName: f.ReleaseName, ParsedRelease: string(f.Parsed), Probe: string(f.Probe), Score: f.Score, Misfit: f.Misfit,
			},
		})
	}
	if len(versions) == 0 {
		return errors.New("none of the files could be adopted")
	}

	adopt := library.AdoptMovie{TitleID: titleID, RootFolder: root, Folder: folder, Versions: versions, PrimaryLanguage: string(e.region.Primary), Monitor: row.Monitor}
	if !tracked {
		if adopt.Details, err = a.d.Meta.Movie(ctx, m.TMDBID); err != nil {
			return err
		}
	}
	id, replaced, err := a.d.Library.AdoptMovie(ctx, adopt)
	if err != nil {
		return err
	}
	a.rescored(ctx, id)
	for _, old := range replaced {
		keep := false
		for _, f := range moved {
			keep = keep || f.To == old.Path
		}
		if !keep {
			removeWithSidecars(old.Path)
		}
	}
	var slots []string
	for _, f := range moved {
		slots = append(slots, f.Slot.String())
	}
	a.d.History.Record(ctx, history.Event{
		Kind: history.AdoptionDone, TitleID: id,
		Message: fmt.Sprintf("Adopted %s (%d) in %s", m.Title, m.Year, strings.Join(slots, ", ")),
	})
	a.folderChanged(ctx, dir)
	return nil
}

// rehome points a file's new path into dir, for a Title whose folder is not
// the one the scan planned.
func rehome(f PlanFile, dir string) PlanFile {
	if filepath.Dir(f.To) == dir {
		return f
	}
	f.To = filepath.Join(dir, filepath.Base(f.To))
	subs := make([]PlanSub, len(f.Subtitles))
	for i, s := range f.Subtitles {
		subs[i] = PlanSub{From: s.From, To: filepath.Join(dir, filepath.Base(s.To))}
	}
	f.Subtitles = subs
	return f
}
