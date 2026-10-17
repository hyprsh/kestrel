package library

import (
	"context"
	"database/sql"
	"errors"

	"github.com/hyprsh/kestrel/internal/library/db"
)

// NewFile is the file an Import puts in a Movie Version.
type NewFile struct {
	VersionID   int64
	Path        string
	Size        int64
	ReleaseName string
	// ParsedRelease and Probe are JSON snapshots.
	ParsedRelease string
	Probe         string
	Score         int
	GrabID        int64
}

func fileOf(f db.File) File {
	out := File{ID: f.ID, Path: f.Path, Size: f.Size, ReleaseName: f.ReleaseName, ParsedRelease: f.ParsedRelease.String, Probe: f.Probe.String, ImportedAt: parseTime(f.ImportedAt)}
	if f.Score.Valid {
		n := int(f.Score.Int64)
		out.Score = &n
	}
	return out
}

// ReplaceFile makes f the one file of its Movie Version in a single
// transaction: the Version's old file rows go, the new row comes, and the
// Title's folder name is set if the first Import has not set it yet. It
// returns the files it replaced so the caller can delete them from disk.
func (s *Service) ReplaceFile(ctx context.Context, titleID int64, folder string, f NewFile) ([]File, error) {
	tx, err := s.st.Write().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	q := db.New(tx)
	if err := q.SetTitleFolder(ctx, db.SetTitleFolderParams{Folder: nullStr(folder), ID: titleID}); err != nil {
		return nil, err
	}
	old, err := q.ListFilesOfVersion(ctx, f.VersionID)
	if err != nil {
		return nil, err
	}
	var replaced []File
	for _, o := range old {
		if err := q.DeleteFile(ctx, o.ID); err != nil {
			return nil, err
		}
		replaced = append(replaced, fileOf(o))
	}
	_, err = q.InsertFile(ctx, db.InsertFileParams{
		VersionID: f.VersionID, Path: f.Path, Size: f.Size, ReleaseName: f.ReleaseName,
		ParsedRelease: nullStr(f.ParsedRelease), Probe: nullStr(f.Probe), Score: sql.NullInt64{Int64: int64(f.Score), Valid: true},
		GrabID: sql.NullInt64{Int64: f.GrabID, Valid: f.GrabID != 0}, ImportedAt: ts(s.clock()),
	})
	if err != nil {
		return nil, err
	}
	return replaced, tx.Commit()
}

// FileOfGrab returns the file the Grab brought, if an Import already
// recorded it.
func (s *Service) FileOfGrab(ctx context.Context, grabID int64) (File, bool, error) {
	f, err := db.New(s.st.Read()).GetFileOfGrab(ctx, sql.NullInt64{Int64: grabID, Valid: true})
	if errors.Is(err, sql.ErrNoRows) {
		return File{}, false, nil
	}
	if err != nil {
		return File{}, false, err
	}
	return fileOf(f), true, nil
}
