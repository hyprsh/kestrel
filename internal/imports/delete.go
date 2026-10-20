package imports

import (
	"context"
	"fmt"
	"path/filepath"
	"slices"
	"strings"

	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/library"
)

// DeletedFile is a file DeleteFiles took off disk.
type DeletedFile struct {
	library.File
	// EpisodeIDs are every episode the file held, in aired order; nil for a Movie.
	EpisodeIDs []int64
	// Blocklisted says its Release went on the Blocklist.
	Blocklisted bool
}

// Deleted is what DeleteFiles did.
type Deleted struct {
	TitleID int64
	Files   []DeletedFile
}

// DeleteFiles deletes files of a Version from disk, with their text
// subtitles, and drops their rows; the Version and its monitoring stay, so a
// monitored Movie or episode is Wanted again. With blocklist the Release of
// each file's Grab goes on the Blocklist too; a file without one (adopted), or
// whose Grab cannot be blocklisted, is deleted all the same and says so. A
// delete event in the Log names the files and what was blocklisted. A Movie
// loses its file; a Series
// the files holding the episodes in scope. A file holding several episodes is
// deleted whole. It waits for an Import into the Title, and returns
// library.ErrVersionNotFound for an unknown Version and a *library.ScopeError
// for a scope the Title does not have (any scope, for a Movie). The zero
// Scope is every file of the Version.
func (s *Service) DeleteFiles(ctx context.Context, versionID int64, scope library.Scope, blocklist bool) (Deleted, error) {
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
	if blocklist {
		s.blocklistDeleted(ctx, out.Files)
	}
	s.recordDeleted(ctx, ref.TitleID, versionID, out.Files, blocklist, code)
	return out, nil
}

// blocklistDeleted puts the Releases of the deleted files on the Blocklist,
// once per Grab (a season pack's files share one), and marks the files whose
// Release went there. A failure leaves the file unmarked: it is gone anyway.
func (s *Service) blocklistDeleted(ctx context.Context, files []DeletedFile) {
	if s.blocklist == nil {
		return
	}
	blocked := map[int64]bool{}
	for i, f := range files {
		if f.GrabID == 0 {
			continue
		}
		ok, tried := blocked[f.GrabID]
		if !tried {
			ok = s.blocklist.BlockGrab(ctx, f.GrabID, "file deleted and blocklisted") == nil
			blocked[f.GrabID] = ok
		}
		files[i].Blocklisted = ok
	}
}

// recordDeleted records the delete event: the files, the episodes that lost
// them and, when asked to blocklist, the Releases that went on the Blocklist.
func (s *Service) recordDeleted(ctx context.Context, titleID, versionID int64, files []DeletedFile, blocklist bool, code map[int64]string) {
	if len(files) == 0 {
		return
	}
	paths, episodes, blocked := make([]string, 0, len(files)), []int64{}, []string{}
	var missed []string
	for _, f := range files {
		paths = append(paths, f.Path)
		episodes = append(episodes, f.EpisodeIDs...)
		switch {
		case f.Blocklisted && !slices.Contains(blocked, f.ReleaseName):
			blocked = append(blocked, f.ReleaseName)
		case blocklist && !f.Blocklisted && !slices.Contains(missed, f.ReleaseName):
			missed = append(missed, f.ReleaseName)
		}
	}
	msg := deletedMessage(files, code)
	if len(blocked) > 0 {
		msg += "; blocklisted " + strings.Join(blocked, ", ")
	}
	if len(missed) > 0 {
		msg += "; not blocklisted " + strings.Join(missed, ", ")
	}
	s.record(ctx, history.Event{
		Kind: history.FilesDeleted, TitleID: titleID, VersionID: versionID, Message: msg,
		Data: jsonOf(map[string]any{"paths": paths, "episode_ids": episodes, "blocklisted": blocked}),
	})
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
