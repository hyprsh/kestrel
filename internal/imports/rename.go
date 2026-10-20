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
	primary := codeOfLanguage(region.Primary.Release())
	original := title.OriginalLanguage
	var moves []library.FileMove
	for _, f := range files {
		cur := f.Path
		if rest, ok := strings.CutPrefix(cur, oldDir+string(filepath.Separator)); ok {
			cur = filepath.Join(newDir, rest)
		}
		want, err := s.wantedPath(d, title, f, cur, primary, original)
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

// wantedPath is the path a file should have in its folder under the current names.
func (s *Service) wantedPath(d library.Detail, title Title, f library.RenameFile, cur, primary, original string) (string, error) {
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
		name, err = EpisodeFileName(title, f.Slot, ep, facts, ext)
	} else {
		name, err = MovieFileName(title, f.Slot, facts, ext)
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
