package acquire

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"sync"

	"github.com/hyprsh/kestrel/internal/acquire/db"
	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/library"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
)

// PollResult is what one poll found.
type PollResult struct {
	// Active is true while any Grab is still downloading: the poll then runs every 10 s.
	Active bool
	// Changed counts the Grabs whose state moved.
	Changed int
}

// Failure reasons of a failed Grab, besides the Import's rejection codes.
const (
	// FailureDownload is a bad download, or one the client's own environment broke.
	FailureDownload = "download_failed"
	// FailureEncrypted is a password-protected download.
	FailureEncrypted = "encrypted"
	// FailureLost is a Grab whose job the client no longer has.
	FailureLost = "lost"
	// FailureDiscarded is a stalled Import a person gave up on.
	FailureDiscarded = "discarded"
)

// lostAfter is how many polls in a row may miss a Grab's job before the Grab
// is lost. At startup one is enough.
const (
	lostAfter        = 2
	lostAfterStartup = 1
)

// missCount counts, per Grab, the polls in a row that did not list its job.
type missCount struct {
	mu sync.Mutex
	m  map[int64]int
}

func (c *missCount) miss(id int64) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.m[id]++
	return c.m[id]
}

func (c *missCount) reset(id int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.m, id)
}

// Poll reads the download client and moves each downloading Grab along: sent
// becomes downloading once the client works on it, and a job is done only when
// the client reports it completed or failed. It is idempotent; polling again
// with nothing new changes nothing.
//
// A failed job heals: failed and encrypted ones are blocklisted, `other` (the
// client's disk or write fault) is not, the job leaves the client with its
// data and the Version's next best Release is grabbed. A Grab whose job two
// polls in a row did not list is lost: it fails as `lost`, is blocklisted and
// retried the same way.
func (s *Service) Poll(ctx context.Context) (PollResult, error) {
	return s.poll(ctx, lostAfter)
}

// Reconcile is the poll at startup: a Grab the client does not list is lost at
// once, as nothing has to settle first.
func (s *Service) Reconcile(ctx context.Context) (PollResult, error) {
	return s.poll(ctx, lostAfterStartup)
}

func (s *Service) poll(ctx context.Context, lostThreshold int) (PollResult, error) {
	grabs, err := db.New(s.st.Read()).ListTrackedGrabs(ctx)
	if err != nil || len(grabs) == 0 {
		return PollResult{}, err
	}
	listed, err := s.dl.List(ctx)
	if err != nil {
		return PollResult{Active: slices.ContainsFunc(grabs, func(g db.Grab) bool { return g.State != "completed" })}, err
	}
	type key struct {
		instance int64
		client   string
	}
	items := map[key]downloadclient.Item{}
	for _, l := range listed {
		items[key{l.InstanceID, l.Item.ClientID}] = l.Item
	}

	var res PollResult
	var errs []error
	now := ts(s.clock())
	// fail records the Grab as failed and heals it; a retry that made a Grab keeps the poll busy.
	fail := func(g db.Grab, failure, message string, block bool, reason string) error {
		if err := s.markFailed(ctx, g, failure, message, now); err != nil {
			return err
		}
		res.Changed++
		retried, err := s.healFailed(ctx, g, failure == FailureLost, block, reason)
		if len(retried) > 0 {
			res.Active = true
		}
		errs = append(errs, err)
		return nil
	}
	for _, g := range grabs {
		it, ok := items[key{g.ClientInstanceID, g.ClientID}]
		if !ok {
			if s.misses.miss(g.ID) < lostThreshold {
				res.Active = res.Active || g.State != "completed"
				continue
			}
			s.misses.reset(g.ID)
			if err := fail(g, FailureLost, "", true, "lost: the download client no longer has the job"); err != nil {
				return res, err
			}
			continue
		}
		s.misses.reset(g.ID)
		if g.State == "completed" {
			continue // waiting for its Import
		}
		state := g.State
		switch it.Phase {
		case downloadclient.PhaseDownloading, downloadclient.PhasePostProcessing:
			state = "downloading"
		case downloadclient.PhaseCompleted:
			state = "completed"
		case downloadclient.PhaseFailed:
			failure, message := FailureDownload, it.Message
			if it.Failure == downloadclient.FailureEncrypted {
				failure, message = FailureEncrypted, "" // the Failure already says it all
			}
			reason := "download " + string(it.Failure)
			if message != "" {
				reason += ": " + message
			}
			// `other` is the client's environment's fault, not the Release's: no Blocklist entry.
			if err := fail(g, failure, message, it.Failure != downloadclient.FailureOther, reason); err != nil {
				return res, err
			}
			continue
		}
		if state != g.State {
			err := db.New(s.st.Write()).SetGrabState(ctx, db.SetGrabStateParams{State: state, UpdatedAt: now, ID: g.ID})
			if err != nil {
				return res, err
			}
			res.Changed++
			s.recordMove(ctx, g, state, "", "")
			if err := s.stampDownload(ctx, g.ID, state, now); err != nil {
				return res, err
			}
		}
		live := Live{Phase: PhaseImporting, BytesTotal: it.BytesTotal}
		if state != "completed" {
			res.Active = true
			live = Live{Phase: phaseOfItem(it.Phase), BytesTotal: it.BytesTotal, BytesLeft: it.BytesLeft, ETA: it.ETA, BytesPerSecond: it.BytesPerSecond}
		}
		// A phase first seen now began at the Grab's last change of state when that state
		// already meant it (queued since the send, downloading since before a restart).
		from := s.clock()
		if state == g.State && phaseOfState(state) == live.Phase {
			from = parseTime(g.UpdatedAt)
		}
		s.live.set(g.ID, live, from, s.clock())
	}
	return res, errors.Join(errs...)
}

// stampDownload keeps when the download client started and finished a Grab, for the Overview's statistics.
func (s *Service) stampDownload(ctx context.Context, id int64, state, now string) error {
	q := db.New(s.st.Write())
	switch state {
	case "downloading":
		return q.StampDownloadStart(ctx, db.StampDownloadStartParams{DownloadStartedAt: sql.NullString{String: now, Valid: true}, ID: id})
	case "completed":
		return q.StampDownloadDone(ctx, db.StampDownloadDoneParams{DownloadDoneAt: sql.NullString{String: now, Valid: true}, ID: id})
	}
	return nil
}

// markFailed moves a Grab to `failed` and records it, with what the client said about it ("" for nothing): the client's
// own copy goes when healFailed removes the job.
func (s *Service) markFailed(ctx context.Context, g db.Grab, failure, message, now string) error {
	err := db.New(s.st.Write()).FailDownload(ctx, db.FailDownloadParams{
		Failure: sql.NullString{String: failure, Valid: true}, FailureMessage: sql.NullString{String: message, Valid: message != ""}, UpdatedAt: now, ID: g.ID,
	})
	if err != nil {
		return err
	}
	s.live.drop(g.ID)
	s.recordMove(ctx, g, "failed", failure, message)
	return nil
}

// healFailed deals with a Grab that failed through no fault of the Version:
// the Release goes on the Blocklist when it was the Release's fault, the job
// leaves the download client with its data (unless the client lost it
// already), and the Version's next best Release is grabbed. It returns the
// Grabs the retry made.
func (s *Service) healFailed(ctx context.Context, g db.Grab, lost, block bool, reason string) ([]Grab, error) {
	var errs []error
	if block {
		errs = append(errs, s.blockGrab(ctx, g, reason))
	}
	if !lost {
		if _, err := s.removeJob(ctx, g.ClientInstanceID, g.ClientID); err != nil {
			errs = append(errs, err)
		}
	}
	retried, err := s.retry(ctx, g, reason, false)
	return retried, errors.Join(append(errs, err)...)
}

// BlockGrab puts the Release of a Grab on the Blocklist, as Cancel with
// blocklist does; a Grab Import kept is found too. It returns ErrGrabNotFound
// for a Grab that does not exist.
func (s *Service) BlockGrab(ctx context.Context, grabID int64, reason string) error {
	g, err := db.New(s.st.Read()).GetGrab(ctx, grabID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrGrabNotFound
	}
	if err != nil {
		return err
	}
	return s.blockGrab(ctx, g, reason)
}

// blockGrab puts a Grab's Release on the Blocklist.
func (s *Service) blockGrab(ctx context.Context, g db.Grab, reason string) error {
	return s.Block(ctx, BlockEntry{
		ReleaseName: g.ReleaseName, IndexerID: g.IndexerID, GUID: g.ReleaseGuid, PublishedAt: parseTime(g.PublishedAt), Size: g.Size,
		Reason: reason, TitleID: g.TitleID.Int64, VersionID: g.VersionID.Int64, GrabID: g.ID,
	})
}

// retry grabs the next best Release for the Version a Grab was for: from the
// candidate cache while it is fresh, else from a new search. With nothing left
// the Version stays Wanted and the sweep finds it again. There is no limit on
// retries.
// why says what made the Grab need replacing; the Log shows it as the reason of the search and of the Grab it finds.
//
// The retry searches only what the Grab was for: its season or episodes. With gated (a rejected Import, a Cancel
// with blocklist) it also obeys the Version's cooldown: each rejection in a row doubles the wait before the next
// such retry (library.NoteRejection), and a retry that must wait is left to the sweep.
func (s *Service) retry(ctx context.Context, g db.Grab, why string, gated bool) ([]Grab, error) {
	also, err := db.New(s.st.Read()).ListGrabVersionsOf(ctx, g.ID)
	if err != nil {
		return nil, err
	}
	return s.retryVersions(ctx, g, also, why, gated)
}

// scopeOfGrab is the season or episodes a Grab was for; the whole Title for a Movie or a Grab with no episodes.
func (s *Service) scopeOfGrab(ctx context.Context, g db.Grab) library.Scope {
	ids, err := s.GrabEpisodes(ctx, g.ID)
	if err != nil || len(ids) == 0 {
		return library.Scope{}
	}
	sc := library.Scope{EpisodeIDs: ids}
	eps, err := s.lib.Episodes(ctx, g.TitleID.Int64, library.View{Now: s.clock()})
	if err != nil {
		return sc
	}
	season, one := -1, true
	for _, ep := range eps {
		if slices.Contains(ids, ep.ID) {
			one = one && (season == -1 || season == ep.Season)
			season = ep.Season
		}
	}
	if one && season >= 0 {
		sc.Season = &season
	}
	return sc
}

// retryVersions is retry for a Grab that also filled the Versions in also: each looks for its next best Release.
func (s *Service) retryVersions(ctx context.Context, g db.Grab, also []int64, why string, gated bool) ([]Grab, error) {
	if !g.TitleID.Valid || !g.VersionID.Valid {
		return nil, nil // the Title or Version was removed meanwhile
	}
	versions := append([]int64{g.VersionID.Int64}, also...)
	if gated {
		var ready []int64
		for _, v := range versions {
			r, err := s.lib.NoteRejection(ctx, v, s.clock())
			if err != nil {
				return nil, err
			}
			if r.Now {
				ready = append(ready, v)
			}
		}
		if versions = ready; len(versions) == 0 {
			return nil, nil // in its cooldown: the sweep retries when it ends
		}
	}
	scope := s.scopeOfGrab(ctx, g)
	ctx = history.WithTrigger(withReason(ctx, "retry: "+why), retryTrigger)
	// A failed Upgrade leaves a Filled Version: its next best Release is the next Upgrade.
	upgrade := g.IsUpgrade == 1
	// Only whole-Version retries coalesce: one waiting for a turn covers another only if it searches as much.
	out, coalesced, err := s.searchGuarded(ctx, g.TitleID.Int64, versions, scope, true, upgrade, !scope.Narrow())
	if coalesced {
		return nil, nil // another retry of these Versions waits its turn and plans from fresh state
	}
	by := "Searched to retry"
	if upgrade {
		by = "Searched to retry the Upgrade"
	}
	s.noteAutomatic(ctx, g.TitleID.Int64, by, out, err)
	if errors.Is(err, library.ErrNotFound) {
		return nil, nil
	}
	return out.Grabbed, err
}
