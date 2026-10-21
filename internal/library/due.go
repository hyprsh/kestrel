package library

import (
	"context"
	"database/sql"

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
