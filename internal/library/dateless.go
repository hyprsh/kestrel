package library

import (
	"context"
	"database/sql"
	"time"

	"github.com/hyprsh/kestrel/internal/library/db"
	"github.com/hyprsh/kestrel/internal/metadata"
)

// DatelessEvery is how often the sweep searches a monitored Movie with no
// release date anywhere and no Release seen yet, in case its Release has
// already left RSS.
const DatelessEvery = 7 * 24 * time.Hour

// movieReleased is when a Movie came out for the household: its release date
// in the country (with the usual fallback to the US, then anywhere), else, when
// it has no release date anywhere, when a Release for it was first seen. nil
// while neither is known.
func movieReleased(rel metadata.ReleaseDates, country string, seen sql.NullString) *time.Time {
	if released, ok := rel.Released(country); ok {
		return &released
	}
	return optTime(seen)
}

// Dateless is whether the Title is a Movie with no release date anywhere: it
// counts as released only once a Release for it has been seen (MarkReleaseSeen).
func (d Detail) Dateless() bool {
	if d.Kind != Movie {
		return false
	}
	_, ok := d.ReleaseDates.Released("")
	return !ok
}

// MarkReleaseSeen records that a Release for a Movie was seen at `at` (in RSS or
// a search). Only the first sighting is kept; a Series is left alone.
func (s *Service) MarkReleaseSeen(ctx context.Context, titleID int64, at time.Time) error {
	return db.New(s.st.Write()).MarkReleaseSeen(ctx, db.MarkReleaseSeenParams{
		ReleaseSeenAt: sql.NullString{String: ts(at), Valid: true}, ID: titleID,
	})
}
