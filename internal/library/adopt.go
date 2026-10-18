package library

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/hyprsh/kestrel/internal/library/db"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/slot"
)

// UpgradeSweepAfter is how long an adopted Version waits for its first Upgrade
// search: adopted files are the baseline, not something to search for at once.
const UpgradeSweepAfter = 30 * 24 * time.Hour

// Tracked is a Title with the folder its files live in, for Adoption and
// Clean up to find the Unmanaged files next to them.
type Tracked struct {
	TitleID    int64
	Kind       Kind
	TMDBID     int
	TVDBID     int
	RootFolder string
	// Folder is the Title folder under RootFolder; "" until the first Import or Adoption.
	Folder string
}

// Tracked lists every Title with its folder.
func (s *Service) Tracked(ctx context.Context) ([]Tracked, error) {
	titles, err := db.New(s.st.Read()).ListTitles(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Tracked, len(titles))
	for i, t := range titles {
		out[i] = Tracked{
			TitleID: t.ID, Kind: Kind(t.Kind), TMDBID: int(t.TmdbID.Int64), TVDBID: int(t.TvdbID.Int64),
			RootFolder: t.RootFolder, Folder: t.Folder.String,
		}
	}
	return out, nil
}

// HeldPaths is the set of file paths some Version holds.
func (s *Service) HeldPaths(ctx context.Context) (map[string]bool, error) {
	files, err := db.New(s.st.Read()).ListFiles(ctx)
	if err != nil {
		return nil, err
	}
	out := make(map[string]bool, len(files))
	for _, f := range files {
		out[f.Path] = true
	}
	return out, nil
}

// AdoptVersion is one Slot of an Adopted Movie: the file an existing file on
// disk becomes the Version's.
type AdoptVersion struct {
	Slot slot.Slot
	// Profile is used when the Title has no Version in the Slot yet.
	Profile string
	File    NewFile
	// Replace allows the file to take the place of one the Version holds.
	Replace bool
}

// AdoptMovie is a Movie to take over with the files it already has.
type AdoptMovie struct {
	// TitleID is the tracked Title to add to; 0 adds the Movie from Details
	// (or finds it, if it was added meanwhile).
	TitleID         int64
	Details         metadata.MovieDetails
	PrimaryLanguage string
	RootFolder      string
	// Folder is the Title folder; it is only set if the Title has none yet.
	Folder   string
	Versions []AdoptVersion
}

// AdoptMovie writes an Adoption of one Movie in a single transaction: the
// Title if it is new, the missing Versions, and the files. A Version that
// already holds a file keeps it unless the AdoptVersion says Replace. It
// returns the Title's id and the files it replaced, which the caller deletes
// from disk. A new Version is Wanted-free: its missing sweep joins the rolling
// one, and its Upgrade sweep comes after UpgradeSweepAfter.
func (s *Service) AdoptMovie(ctx context.Context, a AdoptMovie) (int64, []File, error) {
	tx, err := s.st.Write().BeginTx(ctx, nil)
	if err != nil {
		return 0, nil, err
	}
	defer tx.Rollback()
	q := db.New(tx)
	now := s.clock()

	id := a.TitleID
	if id == 0 {
		existing, err := q.FindTitlesByTMDB(ctx, string(Movie))
		if err != nil {
			return 0, nil, err
		}
		for _, e := range existing {
			if e.TmdbID.Int64 == int64(a.Details.TMDBID) {
				id = e.ID
			}
		}
	}
	if id == 0 {
		d := a.Details
		primary := d.TitleIn(a.PrimaryLanguage)
		if primary == "" {
			primary = d.Title
		}
		if id, err = insertMovie(ctx, q, AddMovie{Details: d, RootFolder: a.RootFolder}, primary, ts(now)); err != nil {
			return 0, nil, err
		}
	} else if _, err := q.GetTitle(ctx, id); errors.Is(err, sql.ErrNoRows) {
		return 0, nil, ErrNotFound
	} else if err != nil {
		return 0, nil, err
	}
	if a.Folder != "" {
		if err := q.SetTitleFolder(ctx, db.SetTitleFolderParams{Folder: nullStr(a.Folder), ID: id}); err != nil {
			return 0, nil, err
		}
	}
	existing, err := q.ListVersionsOfTitle(ctx, id)
	if err != nil {
		return 0, nil, err
	}
	var replaced []File
	for _, v := range a.Versions {
		var vid int64
		for _, e := range existing {
			if slotOf(e.Slot) == v.Slot {
				vid = e.ID
			}
		}
		if vid == 0 {
			if vid, err = q.InsertVersion(ctx, db.InsertVersionParams{TitleID: id, Slot: v.Slot.Key(), ProfileKey: v.Profile, AddedAt: ts(now)}); err != nil {
				return 0, nil, err
			}
			if err := q.InsertSearchState(ctx, db.InsertSearchStateParams{
				VersionID: vid, NextMissingAt: sql.NullString{String: ts(now), Valid: true},
				NextUpgradeAt: sql.NullString{String: ts(now.Add(UpgradeSweepAfter)), Valid: true},
			}); err != nil {
				return 0, nil, err
			}
		}
		old, err := q.ListFilesOfVersion(ctx, vid)
		if err != nil {
			return 0, nil, err
		}
		if len(old) > 0 && !v.Replace {
			return 0, nil, ErrSlotTaken
		}
		for _, o := range old {
			if err := q.DeleteFile(ctx, o.ID); err != nil {
				return 0, nil, err
			}
			replaced = append(replaced, fileOf(o))
		}
		f := v.File
		fileID, err := q.InsertFile(ctx, db.InsertFileParams{
			VersionID: vid, Path: f.Path, Size: f.Size, ReleaseName: f.ReleaseName,
			ParsedRelease: nullStr(f.ParsedRelease), Probe: nullStr(f.Probe), Score: sql.NullInt64{Int64: int64(f.Score), Valid: true},
			ImportedAt: ts(now),
		})
		if err != nil {
			return 0, nil, err
		}
		if f.Misfit {
			if err := q.SetMisfit(ctx, fileID); err != nil {
				return 0, nil, err
			}
		}
	}
	return id, replaced, tx.Commit()
}

// AdoptSeriesFile is a file that becomes the file of some episodes of a Version.
type AdoptSeriesFile struct {
	File     NewFile
	Episodes []EpisodeRef
	// Replace allows the file to take episodes from the file that holds them.
	Replace bool
}

// AdoptSeriesVersion is one Slot of an Adopted Series.
type AdoptSeriesVersion struct {
	Slot slot.Slot
	// Profile is used when the Title has no Version in the Slot yet.
	Profile string
	Files   []AdoptSeriesFile
}

// AdoptSeries is a Series to take over with the episode files it already has.
type AdoptSeries struct {
	// TitleID is the tracked Series to add to; 0 adds the Series from TMDB and
	// TVDB (or finds it, if it was added meanwhile).
	TitleID         int64
	TMDB            metadata.SeriesDetails
	TVDB            metadata.TVDBSeries
	PrimaryLanguage string
	RootFolder      string
	// Folder is the Title folder.
	Folder   string
	Versions []AdoptSeriesVersion
}

// AdoptSeries writes an Adoption of one Series in a single transaction: the
// Title if it is new (monitoring All), the missing Versions, and the episode
// files. An episode that already has a file in the Version keeps it unless the
// file says Replace. It returns the Title's id and the files that no longer
// hold any episode, which the caller deletes from disk. Like AdoptMovie, a new
// Version joins the rolling missing sweep and waits UpgradeSweepAfter for its
// first Upgrade search.
func (s *Service) AdoptSeries(ctx context.Context, a AdoptSeries) (int64, []File, error) {
	tx, err := s.st.Write().BeginTx(ctx, nil)
	if err != nil {
		return 0, nil, err
	}
	defer tx.Rollback()
	q := db.New(tx)
	now := s.clock()

	id := a.TitleID
	if id == 0 {
		existing, err := q.FindTitlesByTMDB(ctx, string(Series))
		if err != nil {
			return 0, nil, err
		}
		for _, e := range existing {
			if e.TmdbID.Int64 == int64(a.TMDB.TMDBID) {
				id = e.ID
			}
		}
	}
	if id == 0 {
		if id, _, err = insertSeries(ctx, q, AddSeries{
			TMDB: a.TMDB, TVDB: a.TVDB, PrimaryLanguage: a.PrimaryLanguage, Monitor: MonitorAll, RootFolder: a.RootFolder,
		}, now); err != nil {
			return 0, nil, err
		}
	} else if t, err := q.GetTitle(ctx, id); errors.Is(err, sql.ErrNoRows) {
		return 0, nil, ErrNotFound
	} else if err != nil {
		return 0, nil, err
	} else if Kind(t.Kind) != Series {
		return 0, nil, ErrNotASeries
	}
	if a.Folder != "" {
		if err := q.SetTitleFolder(ctx, db.SetTitleFolderParams{Folder: nullStr(a.Folder), ID: id}); err != nil {
			return 0, nil, err
		}
	}
	eps, err := q.ListEpisodesOfTitle(ctx, id)
	if err != nil {
		return 0, nil, err
	}
	byRef := make(map[EpisodeRef]int64, len(eps))
	for _, e := range eps {
		byRef[EpisodeRef{int(e.Season), int(e.Number)}] = e.ID
	}
	seasons, err := q.ListSeasonsOfTitle(ctx, id)
	if err != nil {
		return 0, nil, err
	}
	existing, err := q.ListVersionsOfTitle(ctx, id)
	if err != nil {
		return 0, nil, err
	}
	var replaced []File
	for _, v := range a.Versions {
		var vid int64
		for _, e := range existing {
			if slotOf(e.Slot) == v.Slot {
				vid = e.ID
			}
		}
		if vid == 0 {
			if vid, err = q.InsertVersion(ctx, db.InsertVersionParams{TitleID: id, Slot: v.Slot.Key(), ProfileKey: v.Profile, AddedAt: ts(now)}); err != nil {
				return 0, nil, err
			}
			for _, season := range seasons {
				if season.Number == 0 {
					continue // Specials are never searched automatically
				}
				if err := q.InsertSearchState(ctx, db.InsertSearchStateParams{
					VersionID: vid, Season: sql.NullInt64{Int64: season.Number, Valid: true},
					NextMissingAt: sql.NullString{String: ts(now), Valid: true},
					NextUpgradeAt: sql.NullString{String: ts(now.Add(UpgradeSweepAfter)), Valid: true},
				}); err != nil {
					return 0, nil, err
				}
			}
		}
		for _, f := range v.Files {
			var ids []int64
			for _, ref := range f.Episodes {
				if ep, ok := byRef[ref]; ok {
					ids = append(ids, ep)
				}
			}
			if len(ids) == 0 {
				return 0, nil, errors.New("library: none of the file's episodes is in the Series")
			}
			if !f.Replace {
				for _, ep := range ids {
					if _, err := q.GetFileOfVersionEpisode(ctx, db.GetFileOfVersionEpisodeParams{VersionID: vid, EpisodeID: ep}); err == nil {
						return 0, nil, ErrSlotTaken
					} else if !errors.Is(err, sql.ErrNoRows) {
						return 0, nil, err
					}
				}
			}
			nf := f.File
			nf.VersionID = vid
			old, err := putEpisodeFile(ctx, q, nf, ids, now)
			if err != nil {
				return 0, nil, err
			}
			replaced = append(replaced, old...)
		}
	}
	return id, replaced, tx.Commit()
}
