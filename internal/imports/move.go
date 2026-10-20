package imports

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/hyprsh/kestrel/internal/library"
)

var (
	// ErrImportRunning means an Import into the Title is running; a Move can be tried again after it.
	ErrImportRunning = errors.New("an Import into this Title is running; try again when it is done")
	// ErrOtherFilesystem means the target Root folder is on another filesystem than the Title's folder.
	ErrOtherFilesystem = errors.New("that Root folder is on another filesystem; Kestrel moves a Title only between Root folders on the same mount")
)

// Moved is what Move did.
type Moved struct {
	// From and To are the Title's Root folder before and after.
	From, To string
	// Changed says the Title's folder moved on disk.
	Changed bool
	// Files is how many recorded file paths changed.
	Files int
}

// Move puts a Title in another Root folder: its folder moves there under the
// same name in one directory rename, taking every Version's files and their
// subtitles along, and one database write records the new Root folder and file
// paths. If that write fails the folder is moved back, so disk and database
// never disagree. A Title with no folder on disk only has its Root folder
// changed. Moving to the current Root folder does nothing. The caller checks
// that root is one of the kind's Root folders.
func (s *Service) Move(ctx context.Context, titleID int64, root string) (Moved, error) {
	if s.renames == nil {
		return Moved{}, errors.New("imports: moving is not configured")
	}
	unlock, ok := s.guard.lock(titleID, forMove)
	if !ok {
		return Moved{}, ErrImportRunning
	}
	defer unlock()
	region, _, err := s.prof.Region(ctx)
	if err != nil {
		return Moved{}, err
	}
	d, err := s.lib.Get(ctx, titleID, library.View{Country: region.Country, Now: s.clock()})
	if err != nil {
		return Moved{}, err
	}
	out := Moved{From: d.RootFolder, To: root}
	if filepath.Clean(root) == filepath.Clean(d.RootFolder) {
		out.To = d.RootFolder
		return out, nil
	}
	oldDir, newDir := filepath.Join(d.RootFolder, d.Folder), filepath.Join(root, d.Folder)
	onDisk := d.Folder != "" && exists(oldDir)
	var moves []library.FileMove
	if onDisk {
		if exists(newDir) {
			return Moved{}, ErrFolderTaken
		}
		files, err := s.renames.RenameFiles(ctx, titleID)
		if err != nil {
			return Moved{}, err
		}
		for _, f := range files {
			if rest, ok := strings.CutPrefix(f.Path, oldDir+string(filepath.Separator)); ok {
				moves = append(moves, library.FileMove{FileID: f.ID, Path: filepath.Join(newDir, rest)})
			}
		}
		if err := s.rename(oldDir, newDir); err != nil {
			if errors.Is(err, syscall.EXDEV) {
				return Moved{}, ErrOtherFilesystem
			}
			return Moved{}, err
		}
	}
	if err := s.renames.ApplyMove(ctx, titleID, root, moves); err != nil {
		if onDisk {
			if back := s.rename(newDir, oldDir); back != nil {
				return Moved{}, errors.Join(err, back)
			}
		}
		return Moved{}, err
	}
	out.Changed, out.Files = onDisk, len(moves)
	if onDisk && s.folderChanged != nil {
		s.folderChanged(ctx, newDir)
		s.folderChanged(ctx, oldDir)
	}
	return out, nil
}
