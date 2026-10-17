package library

import (
	"context"
	"database/sql"
	"time"

	"github.com/hyprsh/kestrel/internal/library/db"
)

// Due is a Version whose search_state says it is due a search.
type Due struct {
	VersionID int64
	TitleID   int64
}

// DueMissing lists the Movie Versions of monitored Titles whose next missing
// search is due at now, oldest first. Whether a Version still is Wanted is for
// the searcher to check: a Version that got a file or is unreleased stays due
// and is skipped each pass. Series Versions (one row per season) join with the
// Series tickets.
func (s *Service) DueMissing(ctx context.Context, now time.Time) ([]Due, error) {
	rows, err := db.New(s.st.Read()).ListDueMissing(ctx, sql.NullString{String: ts(now), Valid: true})
	if err != nil {
		return nil, err
	}
	out := make([]Due, len(rows))
	for i, r := range rows {
		out[i] = Due{VersionID: r.VersionID, TitleID: r.TitleID}
	}
	return out, nil
}

// MarkMissingSearched records that a Movie Version was searched at `at` and
// schedules its next missing search.
func (s *Service) MarkMissingSearched(ctx context.Context, versionID int64, at, next time.Time) error {
	return db.New(s.st.Write()).MarkMissingSearched(ctx, db.MarkMissingSearchedParams{
		LastMissingAt: sql.NullString{String: ts(at), Valid: true}, NextMissingAt: sql.NullString{String: ts(next), Valid: true}, VersionID: versionID,
	})
}

// RequestSearch makes a Movie Version due a missing search now; the caller
// kicks the sweep. A canceled Grab that was blocklisted uses it to retry.
func (s *Service) RequestSearch(ctx context.Context, versionID int64) error {
	return db.New(s.st.Write()).SetNextMissing(ctx, db.SetNextMissingParams{
		NextMissingAt: sql.NullString{String: ts(s.clock()), Valid: true}, VersionID: versionID,
	})
}
