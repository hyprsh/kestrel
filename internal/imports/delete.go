package imports

import (
	"context"
	"fmt"
	"path/filepath"
	"slices"
	"strings"

	"github.com/hyprsh/kestrel/internal/library"
)

// DeletedFile is a file DeleteFiles took off disk.
type DeletedFile struct {
	library.File
	// EpisodeIDs are every episode the file held, in aired order; nil for a Movie.
	EpisodeIDs []int64
}

// Deleted is what DeleteFiles did.
type Deleted struct {
	TitleID int64
	Files   []DeletedFile
	// Message says it for the Log; "" when nothing was deleted.
	Message string
}

// DeleteFiles deletes files of a Version from disk, with their text
// subtitles, and drops their rows; the Version and its monitoring stay, so a
// monitored Movie or episode is Wanted again. A Movie loses its file; a Series
// the files holding the episodes in scope. A file holding several episodes is
// deleted whole. It waits for an Import into the Title, and returns
// library.ErrVersionNotFound for an unknown Version and a *library.ScopeError
// for a scope the Title does not have (any scope, for a Movie). The zero
// Scope is every file of the Version.
func (s *Service) DeleteFiles(ctx context.Context, versionID int64, scope library.Scope) (Deleted, error) {
	ref, err := s.lib.GetVersion(ctx, versionID)
	if err != nil {
		return Deleted{}, err
	}
	unlock, _ := s.guard.lock(ref.TitleID, forDelete)
	defer unlock()
	view := library.View{Now: s.clock()}
	d, err := s.lib.Get(ctx, ref.TitleID, view)
	if err != nil {
		return Deleted{}, err
	}
	out := Deleted{TitleID: ref.TitleID}
	var ids []int64
	held := map[int64][]int64{} // file id → its episodes
	code := map[int64]string{}  // episode id → S01E02
	if d.Kind == library.Movie {
		if scope.Season != nil {
			return Deleted{}, &library.ScopeError{Field: "season", Code: "not_a_series", Message: "A Movie has no seasons"}
		}
		if len(scope.EpisodeIDs) > 0 {
			return Deleted{}, &library.ScopeError{Field: "episode_ids", Code: "not_a_series", Message: "A Movie has no episodes"}
		}
		files, err := s.lib.FilesOfVersion(ctx, versionID)
		if err != nil {
			return Deleted{}, err
		}
		for _, f := range files {
			ids = append(ids, f.ID)
		}
	} else {
		eps, err := s.lib.Episodes(ctx, ref.TitleID, view)
		if err != nil {
			return Deleted{}, err
		}
		if err := scope.Check(eps); err != nil {
			return Deleted{}, err
		}
		for _, ep := range eps {
			code[ep.ID] = fmt.Sprintf("S%02dE%02d", ep.Season, ep.Number)
			c := ep.Cells[ref.Slot]
			if !scope.Holds(ep) || c == nil || c.File == nil {
				continue
			}
			if _, seen := held[c.File.ID]; !seen {
				ids = append(ids, c.File.ID)
				held[c.File.ID] = c.File.EpisodeIDs
			}
		}
	}
	if len(ids) == 0 {
		return out, nil
	}
	gone, err := s.lib.RemoveFiles(ctx, versionID, ids)
	if err != nil {
		return Deleted{}, err
	}
	for _, f := range gone {
		removeWithSidecars(f.Path)
		out.Files = append(out.Files, DeletedFile{File: f, EpisodeIDs: held[f.ID]})
	}
	if len(gone) > 0 && d.Folder != "" && s.folderChanged != nil {
		s.folderChanged(ctx, filepath.Join(d.RootFolder, d.Folder))
	}
	out.Message = deletedMessage(out.Files, code)
	return out, nil
}

// deletedMessage is the Log line of a deletion: the file for one, the
// episodes that lost their files for several.
func deletedMessage(files []DeletedFile, code map[int64]string) string {
	if len(files) == 0 {
		return ""
	}
	var eps []string
	for _, f := range files {
		for _, id := range f.EpisodeIDs {
			eps = append(eps, code[id])
		}
	}
	slices.Sort(eps)
	if len(files) == 1 {
		msg := "Deleted " + filepath.Base(files[0].Path)
		if len(eps) > 0 {
			msg += " (" + strings.Join(eps, ", ") + ")"
		}
		return msg
	}
	msg := fmt.Sprintf("Deleted %d files", len(files))
	if len(eps) > 6 {
		return msg + fmt.Sprintf(" of %d episodes, %s to %s", len(eps), eps[0], eps[len(eps)-1])
	}
	return msg + " of " + strings.Join(eps, ", ")
}
