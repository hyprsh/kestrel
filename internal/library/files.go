package library

import (
	"context"
	"database/sql"
	"errors"
	"time"

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
	// Misfit marks a file that fails its Version's Profile gates (Adoption); the Version is Wanted.
	Misfit bool
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

// ReplaceEpisodeFile records f as the file of the given episodes of its Series
// Version, in one transaction: each episode's old file stops holding it, and
// the Title's folder name is set if the first Import has not set it yet. A
// file that no longer holds any episode is deleted and returned, so the
// caller can delete it from disk; a file that still holds another episode
// stays. One file per (Version, episode) is the database's own rule.
func (s *Service) ReplaceEpisodeFile(ctx context.Context, titleID int64, folder string, f NewFile, episodeIDs []int64) ([]File, error) {
	tx, err := s.st.Write().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	q := db.New(tx)
	if err := q.SetTitleFolder(ctx, db.SetTitleFolderParams{Folder: nullStr(folder), ID: titleID}); err != nil {
		return nil, err
	}
	replaced, err := putEpisodeFile(ctx, q, f, episodeIDs, s.clock())
	if err != nil {
		return nil, err
	}
	return replaced, tx.Commit()
}

// FilesOfGrab returns the files an Import recorded for a Grab, oldest first.
func (s *Service) FilesOfGrab(ctx context.Context, grabID int64) ([]File, error) {
	rows, err := db.New(s.st.Read()).ListFilesOfGrab(ctx, sql.NullInt64{Int64: grabID, Valid: true})
	if err != nil {
		return nil, err
	}
	out := make([]File, len(rows))
	for i, r := range rows {
		out[i] = fileOf(r)
	}
	return out, nil
}

// PathsOfVersion are the paths of the files a Version holds.
func (s *Service) PathsOfVersion(ctx context.Context, versionID int64) ([]string, error) {
	rows, err := db.New(s.st.Read()).ListFilesOfVersion(ctx, versionID)
	if err != nil {
		return nil, err
	}
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = r.Path
	}
	return out, nil
}

// putEpisodeFile records f as the file of the given episodes of its Series
// Version inside the caller's transaction, and returns the files that no
// longer hold any episode (already deleted from the database).
func putEpisodeFile(ctx context.Context, q *db.Queries, f NewFile, episodeIDs []int64, now time.Time) ([]File, error) {
	var touched []int64
	for _, ep := range episodeIDs {
		old, err := q.GetFileOfVersionEpisode(ctx, db.GetFileOfVersionEpisodeParams{VersionID: f.VersionID, EpisodeID: ep})
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if err := q.DeleteFileEpisode(ctx, db.DeleteFileEpisodeParams{VersionID: f.VersionID, EpisodeID: ep}); err != nil {
			return nil, err
		}
		touched = append(touched, old)
	}
	fileID, err := q.InsertFile(ctx, db.InsertFileParams{
		VersionID: f.VersionID, Path: f.Path, Size: f.Size, ReleaseName: f.ReleaseName,
		ParsedRelease: nullStr(f.ParsedRelease), Probe: nullStr(f.Probe), Score: sql.NullInt64{Int64: int64(f.Score), Valid: true},
		GrabID: sql.NullInt64{Int64: f.GrabID, Valid: f.GrabID != 0}, ImportedAt: ts(now),
	})
	if err != nil {
		return nil, err
	}
	for _, ep := range episodeIDs {
		if err := q.InsertFileEpisode(ctx, db.InsertFileEpisodeParams{FileID: fileID, VersionID: f.VersionID, EpisodeID: ep}); err != nil {
			return nil, err
		}
	}
	if f.Misfit {
		if err := q.SetMisfit(ctx, fileID); err != nil {
			return nil, err
		}
	}
	var replaced []File
	done := map[int64]bool{}
	for _, id := range touched {
		if done[id] {
			continue
		}
		done[id] = true
		n, err := q.CountFileEpisodes(ctx, id)
		if err != nil {
			return nil, err
		}
		if n > 0 {
			continue
		}
		row, err := q.GetFile(ctx, id)
		if err != nil {
			return nil, err
		}
		if err := q.DeleteFile(ctx, id); err != nil {
			return nil, err
		}
		replaced = append(replaced, fileOf(row))
	}
	return replaced, nil
}
