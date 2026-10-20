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

// AwaitingRelease is whether the Title is a Movie with no release date
// anywhere that has no Release seen by now: it counts as released only once
// one is seen (MarkReleaseSeen). Until then the sweep searches it
// DatelessEvery.
func (d Detail) AwaitingRelease(now time.Time) bool {
	return d.Kind == Movie && awaitingRelease(d.ReleaseDates, d.ReleaseSeenAt, now)
}

// awaitingRelease is AwaitingRelease's rule for a Movie's dates and first
// sighting.
func awaitingRelease(rel metadata.ReleaseDates, seen *time.Time, now time.Time) bool {
	_, dated := rel.Released("")
	return !dated && (seen == nil || seen.After(now))
}

// MarkReleaseSeen records that a Release for a Movie was seen at `at` (in RSS or
// a search). Only the first sighting is kept; a Series is left alone.
func (s *Service) MarkReleaseSeen(ctx context.Context, titleID int64, at time.Time) error {
	return db.New(s.st.Write()).MarkReleaseSeen(ctx, db.MarkReleaseSeenParams{
		ReleaseSeenAt: sql.NullString{String: ts(at), Valid: true}, ID: titleID,
	})
}
