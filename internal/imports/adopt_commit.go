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
}

// FileTick is one file's tick.
type FileTick struct {
	Path   string
	Ticked bool
}

// editable is the plan's stored rows, read for an edit: ErrBusy while a scan
// or a commit runs, ErrNoRow when there is no plan.
func (a *Adoption) editable(ctx context.Context) ([]db.AdoptionRow, []Row, error) {
	plan, err := a.q.GetAdoptionPlan(ctx)
	if err != nil {
		return nil, nil, err
	}
	switch PlanState(plan.State) {
	case PlanScanning, PlanCommitting:
		return nil, nil, ErrBusy
	case PlanIdle:
		return nil, nil, ErrNoRow
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
	en := entry{Kind: row.kind(), Root: row.EntryRoot, Path: row.Entry, Name: filepath.Base(row.Entry), IsDir: st.IsDir()}
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
	planned.ID = row.ID
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
	at := slices.IndexFunc(recs, func(r db.AdoptionRow) bool { return r.ID == id })
	if at < 0 {
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

// Commit adopts the ticked rows in the background, one transaction per Title.
// revision is the plan's revision the caller reviewed; a plan that changed
// since is ErrStale.
func (a *Adoption) Commit(ctx context.Context, revision int64) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	plan, err := a.q.GetAdoptionPlan(ctx)
	if err != nil {
		return err
	}
	switch PlanState(plan.State) {
	case PlanScanning, PlanCommitting:
		return ErrBusy
	case PlanIdle:
		return ErrStale
	}
	if plan.Revision != revision {
		return ErrStale
	}
	rows, err := a.rows(ctx)
	if err != nil {
		return err
	}
	var todo []Row
	for _, r := range rows {
		if r.willAdopt() {
			todo = append(todo, r)
		}
	}
	if err := a.q.StartAdoptionCommit(ctx, int64(len(todo))); err != nil {
		return err
	}
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		a.runCommit(context.WithoutCancel(ctx), rows, todo)
	}()
	return nil
}

// runCommit adopts the todo rows (a subset of rows) and then keeps every row
// with what became of it.
func (a *Adoption) runCommit(ctx context.Context, rows, todo []Row) {
	defer a.snap.Hold()() // no TRaSH update lands between a row's Scores and the re-score after it
	defer a.clearCurrent()
	var res CommitResult
	outcome := map[int64]FinalOutcome{}
	failure := map[int64]string{}
	e, err := a.env(ctx)
	if err != nil {
		a.d.Logger.Error("adoption commit failed", "err", err)
		res.Failed = len(todo)
		for _, row := range todo {
			outcome[row.ID], failure[row.ID] = EndedFailed, errorText(err)
		}
		todo = nil
	}
	total := int64(len(todo))
	for i, row := range todo {
		a.setCurrent(row.Entry, StepMoving, row.countFiles(PlanFile.adopts))
		if err := a.adoptRow(ctx, e, row); err != nil {
			a.d.Logger.Error("adoption of an entry failed", "entry", row.Entry, "err", err)
			res.Failed++
			outcome[row.ID], failure[row.ID] = EndedFailed, errorText(err)
		} else {
			res.Adopted++
			outcome[row.ID] = EndedAdopted
			if id, ok, err := a.d.Library.Find(ctx, row.kind(), row.Match.TMDBID, row.Match.TVDBID); err == nil && ok {
				res.TitleIDs = append(res.TitleIDs, id)
			}
		}
		_ = a.q.SetAdoptionProgress(ctx, db.SetAdoptionProgressParams{Done: int64(i + 1), Total: total})
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.keepRows(ctx, rows, outcome, failure)
	titles, _ := json.Marshal(append([]int64{}, res.TitleIDs...))
	_ = a.q.FinishAdoptionCommit(ctx, db.FinishAdoptionCommitParams{
		Adopted: sql.NullInt64{Int64: int64(res.Adopted), Valid: true}, Failed: sql.NullInt64{Int64: int64(res.Failed), Valid: true},
		AdoptedTitles: sql.NullString{String: string(titles), Valid: true},
	})
}

// keepRows stores every row with its final outcome: adopted or failed as the
// commit says, and the rows it did not try as skipped, not chosen or unticked.
func (a *Adoption) keepRows(ctx context.Context, rows []Row, outcome map[int64]FinalOutcome, failure map[int64]string) {
	tx, err := a.d.Store.Write().BeginTx(ctx, nil)
	if err != nil {
		a.d.Logger.Error("adoption: keeping the rows failed", "err", err)
		return
	}
	defer tx.Rollback()
	q := db.New(tx)
	for _, r := range rows {
		o, ok := outcome[r.ID]
		if !ok {
			switch r.Status {
			case Skipped:
				o = EndedSkipped
			case NeedsChoice:
				o = EndedNotChosen
			default:
				o = EndedUnticked
			}
		}
		r.Outcome, r.Error = o, failure[r.ID]
		data, err := json.Marshal(r)
		if err == nil {
			err = q.UpdateAdoptionRow(ctx, db.UpdateAdoptionRowParams{Status: string(r.Status), Ticked: b2i(r.Ticked), Data: string(data), ID: r.ID})
		}
		if err != nil {
			a.d.Logger.Error("adoption: keeping a row failed", "entry", r.Entry, "err", err)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		a.d.Logger.Error("adoption: keeping the rows failed", "err", err)
	}
}

// ErrNothingToRetry means no row of the last commit failed.
var ErrNothingToRetry = errors.New("no Adoption entry failed")

// Retry plans the failed entries of the last commit again, in the background
// and without a new scan: the other rows are dropped, and the plan is
// planned again for review.
func (a *Adoption) Retry(ctx context.Context) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	plan, err := a.q.GetAdoptionPlan(ctx)
	if err != nil {
		return err
	}
	switch PlanState(plan.State) {
	case PlanScanning, PlanCommitting:
		return ErrBusy
	case PlanPlanned:
		return ErrNothingToRetry
	}
	rows, err := a.rows(ctx)
	if err != nil {
		return err
	}
	var failed []Row
	for _, r := range rows {
		if r.Outcome == EndedFailed && r.Match != nil {
			failed = append(failed, r)
		}
	}
	if len(failed) == 0 {
		return ErrNothingToRetry
	}
	if err := a.q.StartAdoptionScan(ctx); err != nil {
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
	defer a.clearCurrent()
	planned, err := a.replanFailed(ctx, failed)
	a.mu.Lock()
	defer a.mu.Unlock()
	if err == nil {
		settle(planned)
		err = a.save(ctx, planned)
	}
	if err != nil {
		a.d.Logger.Error("adoption retry failed", "err", err)
		_ = a.q.FailAdoptionScan(ctx, sql.NullString{String: errorText(err), Valid: true})
		return
	}
	_ = a.q.FinishAdoptionScan(ctx, sql.NullString{String: a.d.Clock().UTC().Format("2006-01-02T15:04:05Z07:00"), Valid: true})
}

// replanFailed plans each failed row again against the Title it was matched
// to. An entry whose folder is gone is dropped.
func (a *Adoption) replanFailed(ctx context.Context, failed []Row) ([]Row, error) {
	e, err := a.env(ctx)
	if err != nil {
		return nil, err
	}
	_ = a.q.SetAdoptionProgress(ctx, db.SetAdoptionProgressParams{Done: 0, Total: int64(len(failed))})
	var out []Row
	for i, row := range failed {
		a.setCurrent(row.Entry, StepProbing, 0)
		row.Outcome, row.Error = "", ""
		switch err := a.replan(ctx, e, &row, row.Match.TMDBID); {
		case errors.Is(err, ErrNotSettleable):
			a.d.Logger.Warn("adoption retry: the entry is gone", "entry", row.Entry)
		case err != nil:
			return nil, err
		default:
			out = append(out, row)
		}
		_ = a.q.SetAdoptionProgress(ctx, db.SetAdoptionProgressParams{Done: int64(i + 1), Total: int64(len(failed))})
	}
	return out, nil
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

	adopt := library.AdoptMovie{TitleID: titleID, RootFolder: root, Folder: folder, Versions: versions, PrimaryLanguage: string(e.region.Primary)}
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
