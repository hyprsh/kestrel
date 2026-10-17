package library

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/hyprsh/kestrel/internal/library/db"
)

// ErrSlotTaken means the Title already has a Version in that Slot.
var ErrSlotTaken = errors.New("the Slot already holds a Version")

// Find returns the id of the Title of kind that has the TMDB or TheTVDB id
// (0 means "not given"), or ok false.
func (s *Service) Find(ctx context.Context, kind Kind, tmdbID, tvdbID int) (id int64, ok bool, err error) {
	if tmdbID != 0 {
		found, err := s.InLibrary(ctx, kind, []int{tmdbID})
		if err != nil {
			return 0, false, err
		}
		if id, ok := found[tmdbID]; ok {
			return id, true, nil
		}
	}
	if tvdbID != 0 {
		id, err := db.New(s.st.Read()).FindTitleByKindTVDB(ctx, db.FindTitleByKindTVDBParams{Kind: string(kind), TvdbID: nullInt(tvdbID)})
		if errors.Is(err, sql.ErrNoRows) {
			return 0, false, nil
		}
		if err != nil {
			return 0, false, err
		}
		return id, true, nil
	}
	return 0, false, nil
}

// AddVersion adds a Wanted Version to an existing Title and returns its id; its
// search_state is due now (a Series Version per season but Specials). A Slot
// that already holds a Version is ErrSlotTaken.
func (s *Service) AddVersion(ctx context.Context, titleID int64, v VersionSpec) (int64, error) {
	tx, err := s.st.Write().BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	q := db.New(tx)
	t, err := q.GetTitle(ctx, titleID)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, err
	}
	existing, err := q.ListVersionsOfTitle(ctx, titleID)
	if err != nil {
		return 0, err
	}
	for _, e := range existing {
		if slotOf(e.Slot) == v.Slot {
			return 0, ErrSlotTaken
		}
	}
	now := ts(s.clock())
	vid, err := q.InsertVersion(ctx, db.InsertVersionParams{TitleID: titleID, Slot: slotName(v.Slot), ProfileKey: v.Profile, AddedAt: now})
	if err != nil {
		return 0, fmt.Errorf("library: add the %s Version under %q: %w", v.Slot, v.Profile, err)
	}
	due := sql.NullString{String: now, Valid: true}
	if Kind(t.Kind) == Series {
		seasons, err := q.ListSeasonsOfTitle(ctx, titleID)
		if err != nil {
			return 0, err
		}
		for _, se := range seasons {
			if se.Number == 0 {
				continue
			}
			if err := q.InsertSearchState(ctx, db.InsertSearchStateParams{
				VersionID: vid, Season: sql.NullInt64{Int64: se.Number, Valid: true}, NextMissingAt: due, NextUpgradeAt: due,
			}); err != nil {
				return 0, err
			}
		}
	} else if err := q.InsertSearchState(ctx, db.InsertSearchStateParams{VersionID: vid, NextMissingAt: due, NextUpgradeAt: due}); err != nil {
		return 0, err
	}
	return vid, tx.Commit()
}

// RequestSeasonSearch makes a Series Version due a missing search now in the
// given seasons; the caller kicks the sweep.
func (s *Service) RequestSeasonSearch(ctx context.Context, versionID int64, seasons []int) error {
	q := db.New(s.st.Write())
	now := sql.NullString{String: ts(s.clock()), Valid: true}
	for _, n := range seasons {
		if err := q.SetNextMissingSeason(ctx, db.SetNextMissingSeasonParams{NextMissingAt: now, VersionID: versionID, Season: sql.NullInt64{Int64: int64(n), Valid: true}}); err != nil {
			return err
		}
	}
	return nil
}
