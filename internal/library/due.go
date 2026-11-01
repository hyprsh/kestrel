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
	// Fresh is true when the Version was never searched: its search is the
	// search on add (or after a Request), not a sweep.
	Fresh bool
	// Episodes is how many Wanted episodes a Series Version's search covers
	// (0 for a Movie), for the search status's "12 Versions · 340 episodes".
	Episodes int
}

// RequestSearch makes a Version due a missing search now; the caller
// kicks the sweep. A canceled Grab that was blocklisted uses it to retry.
func (s *Service) RequestSearch(ctx context.Context, versionID int64) error {
	return db.New(s.st.Write()).SetNextMissing(ctx, db.SetNextMissingParams{
		NextMissingAt: sql.NullString{String: ts(s.clock()), Valid: true}, VersionID: versionID,
	})
}

// NextSearch is when a Version is next searched: for what it is missing, and for an Upgrade. A Series Version is
// searched per season, so these are the earliest of its seasons. Nil when the Version has no search to come (an
// unmonitored Title has none).
type NextSearch struct {
	Missing, Upgrade *time.Time
}

// NextSearches returns, for each Version of a Title, when its next search is due.
func (s *Service) NextSearches(ctx context.Context, titleID int64) (map[int64]NextSearch, error) {
	rows, err := db.New(s.st.Read()).ListSearchStatesOfTitle(ctx, titleID)
	if err != nil {
		return nil, err
	}
	out := map[int64]NextSearch{}
	earliest := func(cur *time.Time, n sql.NullString) *time.Time {
		t := optTime(n)
		if t != nil && (cur == nil || t.Before(*cur)) {
			return t
		}
		return cur
	}
	for _, r := range rows {
		n := out[r.VersionID]
		n.Missing, n.Upgrade = earliest(n.Missing, r.NextMissingAt), earliest(n.Upgrade, r.NextUpgradeAt)
		out[r.VersionID] = n
	}
	return out, nil
}
