package acquire

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire/db"
	"github.com/hyprsh/kestrel/internal/history"
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
	// Reason is the rejection code (invalid, resolution, language, not_upgrade, incomplete_archive)
	// or the stalled reason.
	Reason string
	// Path is the imported file, for the Log; Paths are every Version's file of a Grab that filled several.
	Path  string
	Paths []string
	// Inconclusive says the probe could not tell the audio languages, so the
	// parsed ones stood; the Log notes it.
	Inconclusive bool
	// Episodes are the per-episode results of a Series Import; each goes to the Log.
	Episodes []EpisodeOutcome
	// Replaced is how many files in the library the Import replaced.
	Replaced int
}

// EpisodeOutcome is what an Import did for one episode.
type EpisodeOutcome struct {
	// VersionID is the Version the result is for when one Grab filled several; 0 means the Grab's first.
	VersionID int64
	// EpisodeID is 0 for a file that named no known episode.
	EpisodeID int64
	Season    int
	Number    int
	Status    ImportStatus
	// Reason says why an episode was left alone or stalled.
	Reason string
	// File is the downloaded file; Path the imported one.
	File string
	Path string
}

// NoteChecking records how many downloaded files the running Import of a Grab is checking, for Activity's
// "Importing · checking 2 files". A Grab that is not importing is left alone.
func (s *Service) NoteChecking(ctx context.Context, grabID int64, files int) error {
	return db.New(s.st.Write()).SetImportChecking(ctx, db.SetImportCheckingParams{ImportChecking: sql.NullInt64{Int64: int64(files), Valid: true}, ID: grabID})
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
			g := grabOf(r)
			if err := s.bind(ctx, &g); err != nil {
				return nil, err
			}
			out = append(out, ImportJob{Grab: g, Parsed: r.Parsed, OutputPath: l.Item.OutputPath, CanRemove: l.Item.CanRemove})
			break
		}
	}
	return out, nil
}

// RecordImport records how a Grab's Import ended. imported and rejected end
// the Grab (a rejected Release goes on the Blocklist and the next best one is
// grabbed) and, once the client
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
				Reason:  "stalled: " + o.Reason + "; the Import tries again on a backoff until the environment is fixed",
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
				Reason: "import rejected: " + o.Reason, TitleID: g.TitleID, VersionID: row.VersionID.Int64, GrabID: g.ID,
			}); err != nil {
				return err
			}
		}
		if err := q.FinishGrab(ctx, db.FinishGrabParams{State: state, Failure: failure, UpdatedAt: ts(now), ID: grabID}); err != nil {
			return err
		}
		if o.Status == ImportDone {
			if err := q.SetImportReplaced(ctx, db.SetImportReplacedParams{ImportReplaced: sql.NullInt64{Int64: int64(o.Replaced), Valid: true}, ID: grabID}); err != nil {
				return err
			}
			// An Import ends the run of rejections: the Version's retry cooldown starts over.
			also, err := q.ListGrabVersionsOf(ctx, grabID)
			if err != nil {
				return err
			}
			for _, v := range append([]int64{row.VersionID.Int64}, also...) {
				if err := s.lib.ClearRejections(ctx, v); err != nil {
					return err
				}
			}
		}
		s.live.drop(grabID)
		ev := history.Event{
			Kind: history.ImportDone, TitleID: row.TitleID.Int64, VersionID: row.VersionID.Int64, GrabID: grabID,
			Message: "Imported " + row.ReleaseName + " as " + o.Path,
			Reason:  "imported: the download finished and the Release passed the Import's checks",
		}
		if o.Status == ImportDone {
			data := map[string]any{"path": o.Path}
			if len(o.Paths) > 1 {
				data["paths"] = o.Paths
				ev.Message = "Imported " + row.ReleaseName + " as " + strings.Join(o.Paths, " and ")
			}
			if o.Inconclusive {
				ev.Message += " (probe inconclusive: the parsed languages stand)"
				data["probe_inconclusive"] = true
			}
			ev.Data, _ = json.Marshal(data)
		}
		if o.Status == ImportRejected {
			ev.Kind, ev.Message = history.ImportRejected, "Import of "+row.ReleaseName+" rejected: "+o.Reason
			ev.Reason = "rejected: " + o.Reason
		}
		s.hist.Record(ctx, ev)
		s.recordEpisodes(ctx, row, o.Episodes)
		if canRemove {
			if _, err := s.removeJob(ctx, row.ClientInstanceID, row.ClientID); err != nil {
				return err
			}
		}
		if o.Status == ImportRejected {
			// The Release was unfit: the Version's next best one replaces it.
			_, err := s.retry(ctx, row, "import of "+row.ReleaseName+" rejected: "+o.Reason, true)
			return err
		}
	}
	return nil
}

// recordEpisodes writes one event per episode of a Series Import, so the Log
// shows what became of each file in a pack.
func (s *Service) recordEpisodes(ctx context.Context, row db.Grab, eps []EpisodeOutcome) {
	for _, e := range eps {
		code := fmt.Sprintf("S%02dE%02d", e.Season, e.Number)
		if e.EpisodeID == 0 && e.Number == 0 {
			code = e.File
		}
		msg, reason := code+": imported as "+e.Path, "imported: part of the pack, which passed the Import's checks"
		if e.Status != ImportDone {
			msg, reason = code+": left alone ("+e.Reason+")", "left alone: "+e.Reason
		}
		data, _ := json.Marshal(map[string]any{
			"season": e.Season, "episode": e.Number, "status": e.Status, "reason": e.Reason, "file": e.File, "path": e.Path,
		})
		versionID := row.VersionID.Int64
		if e.VersionID != 0 {
			versionID = e.VersionID
		}
		s.hist.Record(ctx, history.Event{
			Kind: history.ImportEpisode, TitleID: row.TitleID.Int64, VersionID: versionID, EpisodeID: e.EpisodeID, GrabID: row.ID,
			Message: msg, Data: data, Reason: reason,
		})
	}
}
