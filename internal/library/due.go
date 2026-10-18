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
}

// RequestSearch makes a Version due a missing search now; the caller
// kicks the sweep. A canceled Grab that was blocklisted uses it to retry.
func (s *Service) RequestSearch(ctx context.Context, versionID int64) error {
	return db.New(s.st.Write()).SetNextMissing(ctx, db.SetNextMissingParams{
		NextMissingAt: sql.NullString{String: ts(s.clock()), Valid: true}, VersionID: versionID,
	})
}
