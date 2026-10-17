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

// ImportJob is a finished Grab ready for its Import, with what the download
// client says about where the files are.
type ImportJob struct {
	Grab
	// Parsed is the JSON snapshot of the Release's parsed name, taken at Grab.
	Parsed string
	// OutputPath is where the client put the finished job.
	OutputPath string
	// CanRemove is true when the client lets go of the files (Import moves them).
	CanRemove bool
}

// ImportStatus is how an Import ended, as acquire records it.
type ImportStatus string

const (
	ImportDone     ImportStatus = "imported"
	ImportRejected ImportStatus = "rejected"
	ImportStalled  ImportStatus = "stalled"
)

// ImportOutcome is what the imports module reported for a Grab.
type ImportOutcome struct {
	Status ImportStatus
	// Reason is the rejection code (invalid, resolution, language, not_upgrade)
	// or the stalled reason.
	Reason string
	// Path is the imported file, for the Log.
	Path string
}

// stallBackoff is the retry wait of a stalled Import by how long it has stalled:
// 1, 5, 15 and 60 minutes, then hourly. A person's "Retry now" skips the wait.
func stallBackoff(stalledFor time.Duration) time.Duration {
	switch {
	case stalledFor < time.Minute:
		return time.Minute
	case stalledFor < 6*time.Minute:
		return 5 * time.Minute
	case stalledFor < 21*time.Minute:
		return 15 * time.Minute
	}
	return time.Hour
}

// DueImports returns the Grabs to import now: downloads the client finished,
// Imports a restart interrupted and stalled Imports whose retry time has come.
// A finished Grab moves to `importing`. A Grab the client no longer lists is
// left alone (lost Grabs are healed elsewhere).
func (s *Service) DueImports(ctx context.Context) ([]ImportJob, error) {
	now := s.clock()
	rows, err := db.New(s.st.Read()).ListImportableGrabs(ctx, sql.NullString{String: ts(now), Valid: true})
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	listed, err := s.dl.List(ctx)
	if err != nil {
		return nil, err
	}
	var out []ImportJob
	for _, r := range rows {
		for _, l := range listed {
			if l.InstanceID != r.ClientInstanceID || l.Item.ClientID != r.ClientID {
				continue
			}
			if r.State == "completed" {
				if err := db.New(s.st.Write()).StartImport(ctx, db.StartImportParams{UpdatedAt: ts(now), ID: r.ID}); err != nil {
					return nil, err
				}
				r.State = "importing"
			}
			out = append(out, ImportJob{Grab: grabOf(r), Parsed: r.Parsed, OutputPath: l.Item.OutputPath, CanRemove: l.Item.CanRemove})
			break
		}
	}
	return out, nil
}

// RecordImport records how a Grab's Import ended. imported and rejected end
// the Grab (a rejected Release goes on the Blocklist) and, once the client
// lets go of the files, remove its job with the data. stalled keeps the Grab
// `importing` and sets its next retry.
func (s *Service) RecordImport(ctx context.Context, grabID int64, canRemove bool, o ImportOutcome) error {
	row, err := db.New(s.st.Read()).GetGrab(ctx, grabID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrGrabNotFound
	}
	if err != nil {
		return err
	}
	now := s.clock()
	q := db.New(s.st.Write())
	switch o.Status {
	case ImportStalled:
		since := now
		if row.StalledSince.Valid {
			since = parseTime(row.StalledSince.String)
		}
		if !row.StalledSince.Valid || row.StalledReason.String != o.Reason {
			s.hist.Record(ctx, history.Event{
				Kind: history.ImportStalled, TitleID: row.TitleID.Int64, VersionID: row.VersionID.Int64, GrabID: grabID,
				Message: "Import of " + row.ReleaseName + " stalled: " + o.Reason,
			})
		}
		return q.StallImport(ctx, db.StallImportParams{
			StalledReason: sql.NullString{String: o.Reason, Valid: true}, StalledSince: sql.NullString{String: ts(now), Valid: true},
			NextImportAt: sql.NullString{String: ts(now.Add(stallBackoff(now.Sub(since)))), Valid: true}, UpdatedAt: ts(now), ID: grabID,
		})
	case ImportDone, ImportRejected:
		state, failure := "imported", sql.NullString{}
		if o.Status == ImportRejected {
			state, failure = "failed", sql.NullString{String: o.Reason, Valid: true}
			g := grabOf(row)
			if err := s.Block(ctx, BlockEntry{
				ReleaseName: g.ReleaseName, IndexerID: row.IndexerID, GUID: row.ReleaseGuid, PublishedAt: g.PublishedAt, Size: g.Size,
				Reason: "import rejected: " + o.Reason, TitleID: g.TitleID, GrabID: g.ID,
			}); err != nil {
				return err
			}
		}
		if err := q.FinishGrab(ctx, db.FinishGrabParams{State: state, Failure: failure, UpdatedAt: ts(now), ID: grabID}); err != nil {
			return err
		}
		s.live.drop(grabID)
		ev := history.Event{
			Kind: history.ImportDone, TitleID: row.TitleID.Int64, VersionID: row.VersionID.Int64, GrabID: grabID,
			Message: "Imported " + row.ReleaseName + " as " + o.Path,
		}
		if o.Status == ImportRejected {
			ev.Kind, ev.Message = history.ImportRejected, "Import of "+row.ReleaseName+" rejected: "+o.Reason
		}
		s.hist.Record(ctx, ev)
		if canRemove {
			if err := s.dl.Remove(ctx, row.ClientInstanceID, row.ClientID, true); err != nil && !errors.Is(err, instances.ErrNotFound) {
				return err
			}
		}
	}
	return nil
}
