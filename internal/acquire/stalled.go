package acquire

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire/db"
	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
)

// StalledImport is a finished download whose Import waits for the environment
// to be fixed (disk full, a folder not writable, ffprobe missing). It stays
// `importing`, is not blocklisted and retries on its own with a growing wait.
type StalledImport struct {
	Grab
	// Reason says what is wrong, such as "disk full".
	Reason string
	// Since is when the Import first stalled.
	Since time.Time
	// NextAt is when the Import is tried again.
	NextAt time.Time
}

// Stalled lists the stalled Imports, longest stalled first.
func (s *Service) Stalled(ctx context.Context) ([]StalledImport, error) {
	rows, err := db.New(s.st.Read()).ListStalledGrabs(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]StalledImport, len(rows))
	for i, r := range rows {
		out[i] = StalledImport{
			Grab: grabOf(r), Reason: r.StalledReason.String, Since: parseTime(r.StalledSince.String), NextAt: parseTime(r.NextImportAt.String),
		}
	}
	return out, nil
}

// RetryImport makes a stalled Import due now ("Retry now"); the Import loop
// picks it up. It returns ErrGrabNotFound for a Grab that is not stalled.
func (s *Service) RetryImport(ctx context.Context, grabID int64) error {
	now := ts(s.clock())
	n, err := db.New(s.st.Write()).RetryStalledImport(ctx, db.RetryStalledImportParams{
		NextImportAt: sql.NullString{String: now, Valid: true}, UpdatedAt: now, ID: grabID,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrGrabNotFound
	}
	return nil
}

// RetryStalled makes every stalled Import with the reason due now, or all of
// them when reason is empty ("Retry all"), and returns how many.
func (s *Service) RetryStalled(ctx context.Context, reason string) (int, error) {
	stalled, err := s.Stalled(ctx)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, st := range stalled {
		if reason != "" && st.Reason != reason {
			continue
		}
		if err := s.RetryImport(ctx, st.ID); err != nil && !errors.Is(err, ErrGrabNotFound) {
			return n, err
		}
		n++
	}
	return n, nil
}

// Discard gives up on a stalled Import: the Grab fails as `discarded`, with no
// Blocklist entry, the job leaves the download client with its data and the
// Version is Wanted again. It returns ErrGrabNotFound for a Grab that is not stalled.
func (s *Service) Discard(ctx context.Context, grabID int64) error {
	row, err := db.New(s.st.Read()).GetGrab(ctx, grabID)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && (row.State != "importing" || !row.StalledSince.Valid)) {
		return ErrGrabNotFound
	}
	if err != nil {
		return err
	}
	if err := s.dl.Remove(ctx, row.ClientInstanceID, row.ClientID, true); err != nil && !errors.Is(err, instances.ErrNotFound) {
		return err
	}
	err = db.New(s.st.Write()).FinishGrab(ctx, db.FinishGrabParams{
		State: "failed", Failure: sql.NullString{String: FailureDiscarded, Valid: true}, UpdatedAt: ts(s.clock()), ID: grabID,
	})
	if err != nil {
		return err
	}
	s.live.drop(grabID)
	s.hist.Record(ctx, history.Event{
		Kind: history.GrabFailed, TitleID: row.TitleID.Int64, VersionID: row.VersionID.Int64, GrabID: grabID,
		Message: "Discarded the stalled Import of " + row.ReleaseName,
	})
	return nil
}

// DiscardStalled discards every stalled Import with the reason, or all of them
// when reason is empty, and returns how many.
func (s *Service) DiscardStalled(ctx context.Context, reason string) (int, error) {
	stalled, err := s.Stalled(ctx)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, st := range stalled {
		if reason != "" && st.Reason != reason {
			continue
		}
		if err := s.Discard(ctx, st.ID); err != nil && !errors.Is(err, ErrGrabNotFound) {
			return n, err
		}
		n++
	}
	return n, nil
}
