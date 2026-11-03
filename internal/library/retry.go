package library

import (
	"context"
	"database/sql"
	"time"

	"github.com/hyprsh/kestrel/internal/library/db"
)

// The cooldown between the retries a rejected Import or a Cancel with blocklist start.
const (
	// RetryCooldownStart is the cooldown after the first rejection of a Version; each further consecutive
	// rejection doubles it.
	RetryCooldownStart = 15 * time.Minute
	// RetryCooldownMax caps it.
	RetryCooldownMax = 24 * time.Hour
)

// RetryCooldown is the cooldown after a Version's nth consecutive rejection.
func RetryCooldown(n int) time.Duration {
	return min(RetryCooldownStart<<min(max(n-1, 0), 20), RetryCooldownMax)
}

// Retry says whether a retry may run.
type Retry struct {
	// Now is true when the retry may run at once.
	Now bool
	// At is when the cooldown ends, for a retry that must wait. The Version's rows are due then, so
	// the sweep makes the retry.
	At time.Time
}

// NoteRejection records that a Grab of the Version was rejected at its Import or canceled with
// blocklist, and says whether its retry may run now. The first rejection retries at once; each
// further one in a row waits for a cooldown that doubles (RetryCooldown). A retry that waits is left
// to the sweep: the Version's rows come due when the cooldown ends. The state is in search_state,
// so a restart keeps it. An Import (ClearRejections) resets it.
func (s *Service) NoteRejection(ctx context.Context, versionID int64, at time.Time) (Retry, error) {
	rows, err := db.New(s.st.Read()).ListSearchStatesOfVersion(ctx, versionID)
	if err != nil {
		return Retry{}, err
	}
	count := 0
	var until *time.Time
	for _, r := range rows {
		count = max(count, int(r.RetryCount))
		if t := optTime(r.RetryNotBefore); t != nil && (until == nil || t.After(*until)) {
			until = t
		}
	}
	count = min(count+1, 40)
	q := db.New(s.st.Write())
	if until == nil || !at.Before(*until) {
		next := at.Add(RetryCooldown(count))
		return Retry{Now: true}, q.SetSearchStateRetry(ctx, db.SetSearchStateRetryParams{
			RetryCount: int64(count), RetryNotBefore: sql.NullString{String: ts(next), Valid: true}, VersionID: versionID,
		})
	}
	if err := q.SetSearchStateRetry(ctx, db.SetSearchStateRetryParams{
		RetryCount: int64(count), RetryNotBefore: sql.NullString{String: ts(*until), Valid: true}, VersionID: versionID,
	}); err != nil {
		return Retry{}, err
	}
	due := sql.NullString{String: ts(*until), Valid: true}
	return Retry{At: *until}, q.SetSearchStateNextMissingBefore(ctx, db.SetSearchStateNextMissingBeforeParams{
		NextMissingAt: due, VersionID: versionID, NextMissingAt_2: due,
	})
}

// ClearRejections resets the Version's retry cooldown: an Import of it came through.
func (s *Service) ClearRejections(ctx context.Context, versionID int64) error {
	return db.New(s.st.Write()).SetSearchStateRetry(ctx, db.SetSearchStateRetryParams{VersionID: versionID})
}
