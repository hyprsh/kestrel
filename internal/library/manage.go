package library

import (
	"context"
	"database/sql"
	"errors"

	"github.com/hyprsh/kestrel/internal/library/db"
	"github.com/hyprsh/kestrel/internal/slot"
)

func misfitSet(ctx context.Context, q *db.Queries) (map[int64]bool, error) {
	ids, err := q.ListMisfitFileIDs(ctx)
	if err != nil {
		return nil, err
	}
	out := make(map[int64]bool, len(ids))
	for _, id := range ids {
		out[id] = true
	}
	return out, nil
}

// ErrVersionNotFound is returned for a Version that does not exist.
var ErrVersionNotFound = errors.New("version not found")

// VersionRef is a Version with the Title it belongs to.
type VersionRef struct {
	ID      int64
	TitleID int64
	Slot    slot.Slot
	Profile string
}

// GetVersion returns one Version, or ErrVersionNotFound.
func (s *Service) GetVersion(ctx context.Context, id int64) (VersionRef, error) {
	v, err := db.New(s.st.Read()).GetVersion(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return VersionRef{}, ErrVersionNotFound
	}
	if err != nil {
		return VersionRef{}, err
	}
	return VersionRef{ID: v.ID, TitleID: v.TitleID, Slot: slotOf(v.Slot), Profile: v.ProfileKey}, nil
}

// FilesOfVersion lists the files a Version holds (a Movie Version one, a
// Series Version one per Import), with their misfit flag.
func (s *Service) FilesOfVersion(ctx context.Context, versionID int64) ([]File, error) {
	q := db.New(s.st.Read())
	rows, err := q.ListFilesOfVersion(ctx, versionID)
	if err != nil {
		return nil, err
	}
	misfits, err := misfitSet(ctx, q)
	if err != nil {
		return nil, err
	}
	originals, err := originalSet(ctx, q)
	if err != nil {
		return nil, err
	}
	out := make([]File, len(rows))
	for i, r := range rows {
		out[i] = fileOf(r)
		out[i].Misfit = misfits[r.ID]
		out[i].Original = originals[r.ID]
	}
	return out, nil
}

// SetProfile moves a Version to another Profile and makes it due a missing
// and an upgrade search now; the caller kicks the sweep. Whether the Profile
// belongs to the Version's Slot is for the caller to check.
func (s *Service) SetProfile(ctx context.Context, versionID int64, profile string) error {
	tx, err := s.st.Write().BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	q := db.New(tx)
	if _, err := q.GetVersion(ctx, versionID); errors.Is(err, sql.ErrNoRows) {
		return ErrVersionNotFound
	} else if err != nil {
		return err
	}
	if err := q.SetVersionProfile(ctx, db.SetVersionProfileParams{ProfileKey: profile, ID: versionID}); err != nil {
		return err
	}
	due := sql.NullString{String: ts(s.clock()), Valid: true}
	if err := q.SetNextSearchesAll(ctx, db.SetNextSearchesAllParams{NextMissingAt: due, NextUpgradeAt: due, VersionID: versionID}); err != nil {
		return err
	}
	return tx.Commit()
}

// Rescored is a file's new Score under its Version's new Profile, whether it
// still fits and whether it is an Original (see File).
type Rescored struct {
	FileID   int64
	Score    int
	Misfit   bool
	Original bool
}

// ApplyRescore stores the new Score of files and flags or clears their misfit
// mark. The files keep their names and their place on disk.
func (s *Service) ApplyRescore(ctx context.Context, rs []Rescored) error {
	tx, err := s.st.Write().BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	q := db.New(tx)
	for _, r := range rs {
		if err := q.SetFileScore(ctx, db.SetFileScoreParams{Score: sql.NullInt64{Int64: int64(r.Score), Valid: true}, ID: r.FileID}); err != nil {
			return err
		}
		if r.Misfit {
			err = q.SetMisfit(ctx, r.FileID)
		} else {
			err = q.ClearMisfit(ctx, r.FileID)
		}
		if err != nil {
			return err
		}
		if err := markOriginal(ctx, q, r.FileID, r.Original); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// RemoveVersion deletes a Version, its files' rows and its search state, and
// returns the files that were on disk so the caller can delete them if asked.
func (s *Service) RemoveVersion(ctx context.Context, versionID int64) ([]File, error) {
	files, err := s.FilesOfVersion(ctx, versionID)
	if err != nil {
		return nil, err
	}
	tx, err := s.st.Write().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	q := db.New(tx)
	if _, err := q.GetVersion(ctx, versionID); errors.Is(err, sql.ErrNoRows) {
		return nil, ErrVersionNotFound
	} else if err != nil {
		return nil, err
	}
	if err := q.DeleteVersion(ctx, versionID); err != nil {
		return nil, err
	}
	return files, tx.Commit()
}

// Removed is what a removed Title had on disk.
type Removed struct {
	RootFolder string
	// Folder is the Title's folder name under the Root folder; "" before the first Import.
	Folder string
	Files  []File
	// VersionIDs are the Versions it had.
	VersionIDs []int64
}

// RemoveTitle deletes a Title with all it holds and returns what it had on disk.
func (s *Service) RemoveTitle(ctx context.Context, titleID int64) (Removed, error) {
	q := db.New(s.st.Read())
	t, err := q.GetTitle(ctx, titleID)
	if errors.Is(err, sql.ErrNoRows) {
		return Removed{}, ErrNotFound
	}
	if err != nil {
		return Removed{}, err
	}
	vs, err := q.ListVersionsOfTitle(ctx, titleID)
	if err != nil {
		return Removed{}, err
	}
	out := Removed{RootFolder: t.RootFolder, Folder: t.Folder.String}
	for _, v := range vs {
		out.VersionIDs = append(out.VersionIDs, v.ID)
		fs, err := s.FilesOfVersion(ctx, v.ID)
		if err != nil {
			return Removed{}, err
		}
		out.Files = append(out.Files, fs...)
	}
	if err := db.New(s.st.Write()).DeleteTitle(ctx, titleID); err != nil {
		return Removed{}, err
	}
	return out, nil
}
