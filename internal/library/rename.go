package library

import (
	"context"

	"github.com/hyprsh/kestrel/internal/library/db"
	"github.com/hyprsh/kestrel/internal/slot"
)

// EpisodeRef names an episode by its place.
type EpisodeRef struct{ Season, Number int }

// RenameFile is a stored file with what its name is built from.
type RenameFile struct {
	ID            int64
	VersionID     int64
	Slot          slot.Slot
	Path          string
	ParsedRelease string // JSON snapshot
	Probe         string // JSON snapshot
	// Episodes are the episodes a Series file holds, in aired order.
	Episodes []EpisodeRef
}

// RenameFiles lists every file of a Title with the facts its name needs.
func (s *Service) RenameFiles(ctx context.Context, titleID int64) ([]RenameFile, error) {
	q := db.New(s.st.Read())
	files, err := q.ListFilesWithSlot(ctx, titleID)
	if err != nil {
		return nil, err
	}
	refs, err := q.ListFileEpisodeRefs(ctx, titleID)
	if err != nil {
		return nil, err
	}
	epsOf := map[int64][]EpisodeRef{}
	for _, r := range refs {
		epsOf[r.FileID] = append(epsOf[r.FileID], EpisodeRef{Season: int(r.Season), Number: int(r.Number)})
	}
	out := make([]RenameFile, len(files))
	for i, f := range files {
		out[i] = RenameFile{
			ID: f.ID, VersionID: f.VersionID, Slot: slotOf(f.Slot), Path: f.Path,
			ParsedRelease: f.ParsedRelease.String, Probe: f.Probe.String, Episodes: epsOf[f.ID],
		}
	}
	return out, nil
}

// FileMove is a file's new path.
type FileMove struct {
	FileID int64
	Path   string
}

// ApplyRename records, in one transaction, the Title's new folder name and the
// new paths of its files after they were renamed on disk.
func (s *Service) ApplyRename(ctx context.Context, titleID int64, folder string, moves []FileMove) error {
	tx, err := s.st.Write().BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	q := db.New(tx)
	if err := q.ForceTitleFolder(ctx, db.ForceTitleFolderParams{Folder: nullStr(folder), ID: titleID}); err != nil {
		return err
	}
	for _, m := range moves {
		if err := q.SetFilePath(ctx, db.SetFilePathParams{Path: m.Path, ID: m.FileID}); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ApplyMove records, in one transaction, the Title's new Root folder and the
// new paths of its files after its folder moved there on disk.
func (s *Service) ApplyMove(ctx context.Context, titleID int64, root string, moves []FileMove) error {
	tx, err := s.st.Write().BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	q := db.New(tx)
	if err := q.SetTitleRootFolder(ctx, db.SetTitleRootFolderParams{RootFolder: root, ID: titleID}); err != nil {
		return err
	}
	for _, m := range moves {
		if err := q.SetFilePath(ctx, db.SetFilePathParams{Path: m.Path, ID: m.FileID}); err != nil {
			return err
		}
	}
	return tx.Commit()
}
