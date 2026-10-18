package imports

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
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

// PatchRow applies an edit to a row of the plan and returns the row as it is
// afterwards. Every edit moves the plan's revision.
func (a *Adoption) PatchRow(ctx context.Context, id int64, p RowPatch) (Row, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	plan, err := a.q.GetAdoptionPlan(ctx)
	if err != nil {
		return Row{}, err
	}
	switch PlanState(plan.State) {
	case PlanScanning, PlanCommitting:
		return Row{}, ErrBusy
	case PlanIdle:
		return Row{}, ErrNoRow
	}
	recs, err := a.q.ListAdoptionRows(ctx)
	if err != nil {
		return Row{}, err
	}
	rows := make([]Row, len(recs))
	at := -1
	for i, rec := range recs {
		if rows[i], err = rowOf(rec); err != nil {
			return Row{}, err
		}
		if rec.ID == id {
			at = i
		}
	}
	if at < 0 {
		return Row{}, ErrNoRow
	}
	row := &rows[at]
	if p.TMDBID != nil {
		e, err := a.env(ctx)
		if err != nil {
			return Row{}, err
		}
		st, err := os.Stat(row.Entry)
		if err != nil {
			return Row{}, ErrNotSettleable
		}
		en := entry{Root: row.EntryRoot, Path: row.Entry, Name: filepath.Base(row.Entry), IsDir: st.IsDir()}
		if !en.IsDir {
			en.Name = strings.TrimSuffix(en.Name, filepath.Ext(en.Name))
		}
		planned, err := a.planEntry(ctx, e, en, *p.TMDBID)
		if err != nil {
			return Row{}, err
		}
		if planned == nil || planned.Status != Matched {
			return Row{}, ErrNotSettleable
		}
		planned.ID = row.ID
		*row = *planned
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
	settle(rows)
	for i := range rows {
		data, err := json.Marshal(rows[i])
		if err != nil {
			return Row{}, err
		}
		if i != at && string(data) == recs[i].Data && b2i(rows[i].Ticked) == recs[i].Ticked {
			continue
		}
		if err := a.q.UpdateAdoptionRow(ctx, db.UpdateAdoptionRowParams{
			Status: string(rows[i].Status), Ticked: b2i(rows[i].Ticked), Data: string(data), ID: rows[i].ID,
		}); err != nil {
			return Row{}, err
		}
	}
	if err := a.q.BumpAdoptionRevision(ctx); err != nil {
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
		if r.Status == Matched && r.Ticked && r.has(PlanFile.adopts) {
			todo = append(todo, r)
		}
	}
	if err := a.q.StartAdoptionCommit(ctx, int64(len(todo))); err != nil {
		return err
	}
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		a.runCommit(context.WithoutCancel(ctx), todo)
	}()
	return nil
}

func (a *Adoption) runCommit(ctx context.Context, todo []Row) {
	var res CommitResult
	e, err := a.env(ctx)
	if err != nil {
		a.d.Logger.Error("adoption commit failed", "err", err)
		res.Failed = len(todo)
		todo = nil
	}
	total := int64(len(todo))
	for i, row := range todo {
		if err := a.adoptRow(ctx, e, row); err != nil {
			a.d.Logger.Error("adoption of an entry failed", "entry", row.Entry, "err", err)
			res.Failed++
		} else {
			res.Adopted++
		}
		_ = a.q.SetAdoptionProgress(ctx, db.SetAdoptionProgressParams{Done: int64(i + 1), Total: total})
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	_ = a.q.DeleteAdoptionRows(ctx)
	_ = a.q.FinishAdoptionCommit(ctx, db.FinishAdoptionCommitParams{
		Adopted: sql.NullInt64{Int64: int64(res.Adopted), Valid: true}, Failed: sql.NullInt64{Int64: int64(res.Failed), Valid: true},
	})
}

// move is one rename done on disk, kept to undo it.
type move struct{ from, to string }

// adoptRow renames a row's ticked files into the scheme and writes the
// Title's Versions in one transaction. If the transaction fails, every
// rename is undone, so each Title either happened or did not.
func (a *Adoption) adoptRow(ctx context.Context, e *env, row Row) (err error) {
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
				Path: f.To, Size: f.Size, ReleaseName: f.ReleaseName, ParsedRelease: string(f.Parsed), Probe: string(f.Probe), Score: f.Score,
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
