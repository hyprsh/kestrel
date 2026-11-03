package imports

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/probe"
	"github.com/hyprsh/kestrel/internal/release"
)

// RenameStore is what Rename and Move need of the library beyond Library. *library.Service satisfies it.
type RenameStore interface {
	RenameFiles(ctx context.Context, titleID int64) ([]library.RenameFile, error)
	ApplyRename(ctx context.Context, titleID int64, folder string, moves []library.FileMove) error
	ApplyMove(ctx context.Context, titleID int64, root string, moves []library.FileMove) error
}

// ErrFolderTaken means a folder is already where the Title's folder would go.
var ErrFolderTaken = errors.New("a folder with the new name already exists")

// Renamed is what Rename did.
type Renamed struct {
	// Changed says a folder or a file was renamed.
	Changed bool
	// Folder is the Title's folder name now ("" when it has none yet).
	Folder string
	// Files is how many files were renamed.
	Files int
}

// Rename brings a Title's folder and every Version's files in line with its
// current English title and year (ADR 0003), as one unit: the folder first,
// then each file with its subtitles, then one database write. Episode titles
// are not part of a name, so they never cause a rename. It is idempotent and
// finishes what a run that died half way left: a folder already moved or a
// file already renamed is recognised and recorded. A Title with no folder yet
// has nothing to rename.
func (s *Service) Rename(ctx context.Context, titleID int64) (Renamed, error) {
	if s.renames == nil {
		return Renamed{}, errors.New("imports: renaming is not configured")
	}
	unlock, _ := s.guard.lock(titleID, forRename)
	defer unlock()
	region, _, err := s.prof.Region(ctx)
	if err != nil {
		return Renamed{}, err
	}
	d, err := s.lib.Get(ctx, titleID, library.View{Country: region.Country, Now: s.clock()})
	if err != nil {
		return Renamed{}, err
	}
	if d.Folder == "" {
		return Renamed{}, nil
	}
	name := d.Title
	if name == "" {
		name = d.OriginalTitle
	}
	title := Title{Name: name, Year: d.Year, TMDBID: d.TMDBID, TVDBID: d.TVDBID, OriginalLanguage: codeOfLanguage(release.LanguageByISO(d.OriginalLanguage))}
	folderOf := MovieFolder
	if d.Kind == library.Series {
		folderOf = SeriesFolder
	}
	wantFolder, err := folderOf(title)
	if err != nil {
		return Renamed{}, err
	}
	oldDir, newDir := filepath.Join(d.RootFolder, d.Folder), filepath.Join(d.RootFolder, wantFolder)
	out := Renamed{Folder: wantFolder}
	if oldDir != newDir && exists(oldDir) {
		if exists(newDir) {
			return Renamed{Folder: d.Folder}, ErrFolderTaken
		}
		if err := os.Rename(oldDir, newDir); err != nil {
			return Renamed{Folder: d.Folder}, err
		}
		out.Changed = true
	}

	files, err := s.renames.RenameFiles(ctx, titleID)
	if err != nil {
		return Renamed{}, err
	}
	labels := map[Slot]string{}
	for _, f := range files {
		if _, ok := labels[f.Slot]; !ok {
			if labels[f.Slot], err = labelOf(ctx, s.slots, f.Slot); err != nil {
				return Renamed{}, err
			}
		}
	}
	primary := codeOfLanguage(region.Primary.Release())
	original := title.OriginalLanguage
	var moves []library.FileMove
	for _, f := range files {
		cur := f.Path
		if rest, ok := strings.CutPrefix(cur, oldDir+string(filepath.Separator)); ok {
			cur = filepath.Join(newDir, rest)
		}
		want, err := s.wantedPath(d, title, f, labels[f.Slot], cur, primary, original)
		if err != nil || want == cur {
			want = cur
		} else if !exists(cur) && exists(want) {
			// An earlier run moved it; only the record is left.
		} else if exists(want) {
			want = cur // something else sits there: leave this file alone
		} else if exists(cur) {
			if err := renameWithSidecars(cur, want); err != nil {
				return out, fmt.Errorf("rename %s: %w", filepath.Base(cur), err)
			}
			out.Files++
			out.Changed = true
		} else {
			want = cur // the file is gone; nothing to rename
		}
		if want != f.Path {
			moves = append(moves, library.FileMove{FileID: f.ID, Path: want})
		}
	}
	if err := s.renames.ApplyRename(ctx, titleID, wantFolder, moves); err != nil {
		return out, err
	}
	if out.Changed && s.folderChanged != nil {
		s.folderChanged(ctx, newDir)
		if oldDir != newDir {
			s.folderChanged(ctx, oldDir)
		}
	}
	return out, nil
}

// RenameSlot renames the files of every Title that has a Version in the Slot
// after its current label (ADR 0024), through Rename: the same moves, the same
// idempotence, and a Log entry for each Title whose files changed. It returns
// how many files it renamed. A Title that fails to rename is skipped and
// reported in the error, so the rest still follow the new label.
func (s *Service) RenameSlot(ctx context.Context, id Slot) (int, error) {
	return s.RenameSlotProgress(ctx, id, nil)
}

// SlotLabel is the label that names the Slot's files now.
func (s *Service) SlotLabel(ctx context.Context, id Slot) (string, error) {
	return labelOf(ctx, s.slots, id)
}

// RenameSlotProgress is RenameSlot telling progress how many Titles of the Slot
// are done, of how many, before the first and after each one. It stops before
// the next Title once ctx ends.
func (s *Service) RenameSlotProgress(ctx context.Context, id Slot, progress func(done, total int)) (int, error) {
	if s.slots == nil {
		return 0, errors.New("imports: Slot labels are not configured")
	}
	label, err := labelOf(ctx, s.slots, id)
	if err != nil {
		return 0, err
	}
	titles, err := s.slots.TitleIDs(ctx, id)
	if err != nil {
		return 0, err
	}
	var total int
	var errs []error
	if progress != nil {
		progress(0, len(titles))
	}
	for i, tid := range titles {
		if ctx.Err() != nil {
			return total, ctx.Err()
		}
		if progress != nil && i > 0 {
			progress(i, len(titles))
		}
		res, err := s.Rename(ctx, tid)
		if err != nil {
			errs = append(errs, fmt.Errorf("title %d: %w", tid, err))
		}
		if res.Files == 0 {
			continue
		}
		total += res.Files
		noun := "files"
		if res.Files == 1 {
			noun = "file"
		}
		s.record(ctx, history.Event{
			Kind: history.Renamed, TitleID: tid, Data: jsonOf(map[string]any{"from": res.Folder, "to": res.Folder, "files": res.Files, "slot": string(id), "label": label}),
			Message: fmt.Sprintf("Renamed %d %s for the Slot label %q", res.Files, noun, label),
			Trigger: history.TriggerOr(ctx, history.Job(history.TriggerJob, "slot rename")),
			Reason:  fmt.Sprintf("the Slot's label changed to %q", label),
		})
	}
	if progress != nil {
		progress(len(titles), len(titles))
	}
	return total, errors.Join(errs...)
}

// wantedPath is the path a file should have in its folder under the current names.
func (s *Service) wantedPath(d library.Detail, title Title, f library.RenameFile, label, cur, primary, original string) (string, error) {
	var parsed release.ParsedRelease
	var info probe.Info
	if err := json.Unmarshal([]byte(f.ParsedRelease), &parsed); err != nil {
		return "", err
	}
	if err := json.Unmarshal([]byte(f.Probe), &info); err != nil {
		return "", err
	}
	languages, _ := probe.ResolveLanguages(parsedCodes(parsed, original), info.Audio)
	facts := FileFacts{Release: parsed, Probe: info, Languages: languages, Primary: primary}
	ext := strings.ToLower(filepath.Ext(cur))
	var name string
	var err error
	if d.Kind == library.Series {
		if len(f.Episodes) == 0 {
			return "", errors.New("the file holds no episode")
		}
		ep := Episode{Season: f.Episodes[0].Season, First: f.Episodes[0].Number, Last: f.Episodes[0].Number}
		for _, e := range f.Episodes {
			ep.First, ep.Last = min(ep.First, e.Number), max(ep.Last, e.Number)
		}
		name, err = EpisodeFileName(title, label, ep, facts, ext)
	} else {
		name, err = MovieFileName(title, label, facts, ext)
	}
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(cur), name), nil
}

// renameWithSidecars renames a video and the subtitles named after it.
func renameWithSidecars(from, to string) error {
	oldStem := strings.TrimSuffix(from, filepath.Ext(from))
	newStem := strings.TrimSuffix(to, filepath.Ext(to))
	subs, _ := filepath.Glob(escapeGlob(oldStem) + ".*")
	if err := os.Rename(from, to); err != nil {
		return err
	}
	for _, sub := range subs {
		if sub == from || !textSubExts[strings.ToLower(filepath.Ext(sub))] {
			continue
		}
		dst := newStem + strings.TrimPrefix(sub, oldStem)
		if slices.Contains(subs, dst) || exists(dst) {
			continue
		}
		_ = os.Rename(sub, dst)
	}
	return nil
}
