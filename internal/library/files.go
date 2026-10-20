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
	// Original marks an Original (see File): the Version is filled, but any
	// acceptable Release replaces it.
	Original bool
}

func fileOf(f db.File) File {
	out := File{ID: f.ID, Path: f.Path, Size: f.Size, ReleaseName: f.ReleaseName, ParsedRelease: f.ParsedRelease.String, Probe: f.Probe.String, ImportedAt: parseTime(f.ImportedAt), GrabID: f.GrabID.Int64}
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
	fileID, err := q.InsertFile(ctx, db.InsertFileParams{
		VersionID: f.VersionID, Path: f.Path, Size: f.Size, ReleaseName: f.ReleaseName,
		ParsedRelease: nullStr(f.ParsedRelease), Probe: nullStr(f.Probe), Score: sql.NullInt64{Int64: int64(f.Score), Valid: true},
		GrabID: sql.NullInt64{Int64: f.GrabID, Valid: f.GrabID != 0}, ImportedAt: ts(s.clock()),
	})
	if err != nil {
		return nil, err
	}
	if err := markFile(ctx, q, fileID, f.Misfit, f.Original); err != nil {
		return nil, err
	}
	if err := recordReplacedScore(ctx, q, fileID, replaced); err != nil {
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

// FilesReplacedBy lists the files of a Version that a new file for these
// episodes would leave holding no episode: the ones ReplaceEpisodeFile deletes.
// An Import names them before it commits, so a crash cannot orphan them.
func (s *Service) FilesReplacedBy(ctx context.Context, versionID int64, episodeIDs []int64) ([]File, error) {
	q := db.New(s.st.Read())
	taken := map[int64]int64{} // file id -> how many of the episodes it holds
	var order []int64
	for _, ep := range episodeIDs {
		id, err := q.GetFileOfVersionEpisode(ctx, db.GetFileOfVersionEpisodeParams{VersionID: versionID, EpisodeID: ep})
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if taken[id] == 0 {
			order = append(order, id)
		}
		taken[id]++
	}
	var out []File
	for _, id := range order {
		held, err := q.CountFileEpisodes(ctx, id)
		if err != nil {
			return nil, err
		}
		if held > taken[id] {
			continue // it still holds other episodes
		}
		row, err := q.GetFile(ctx, id)
		if err != nil {
			return nil, err
		}
		out = append(out, fileOf(row))
	}
	return out, nil
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
	if err := markFile(ctx, q, fileID, f.Misfit, f.Original); err != nil {
		return nil, err
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
	if err := recordReplacedScore(ctx, q, fileID, replaced); err != nil {
		return nil, err
	}
	return replaced, nil
}

// recordReplacedScore keeps the best Score among the files a new file replaced,
// for the Upgrade's gain in "Recently added". Nothing is kept if none was scored.
func recordReplacedScore(ctx context.Context, q *db.Queries, fileID int64, replaced []File) error {
	best := -1 << 31
	found := false
	for _, r := range replaced {
		if r.Score != nil && (!found || *r.Score > best) {
			best, found = *r.Score, true
		}
	}
	if !found {
		return nil
	}
	return q.SetReplacedScore(ctx, db.SetReplacedScoreParams{FileID: fileID, Score: int64(best)})
}

// RemoveFiles drops the rows of a Version's files in one transaction, their
// episodes with them, and returns the files so the caller can delete them from
// disk. Ids that are not files of the Version are skipped. The Version and its
// monitoring stay: a monitored Movie or episode without a file is Wanted.
func (s *Service) RemoveFiles(ctx context.Context, versionID int64, fileIDs []int64) ([]File, error) {
	tx, err := s.st.Write().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	q := db.New(tx)
	var out []File
	for _, id := range fileIDs {
		row, err := q.GetFile(ctx, id)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if row.VersionID != versionID {
			continue
		}
		if err := q.DeleteFile(ctx, id); err != nil {
			return nil, err
		}
		out = append(out, fileOf(row))
	}
	return out, tx.Commit()
}
