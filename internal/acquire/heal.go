package acquire

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"sync"

	"github.com/hyprsh/kestrel/internal/acquire/db"
	"github.com/hyprsh/kestrel/internal/library"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
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
	fail := func(g db.Grab, failure string, block bool, reason string) error {
		if err := s.markFailed(ctx, g, failure, now); err != nil {
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
			if err := fail(g, FailureLost, true, "lost: the download client no longer has the job"); err != nil {
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
			failure := FailureDownload
			if it.Failure == downloadclient.FailureEncrypted {
				failure = FailureEncrypted
			}
			// `other` is the client's environment's fault, not the Release's: no Blocklist entry.
			if err := fail(g, failure, it.Failure != downloadclient.FailureOther, "download "+string(it.Failure)); err != nil {
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
			s.recordMove(ctx, g, state, "")
		}
		if state == "completed" {
			s.live.set(g.ID, Live{Phase: PhaseImporting, BytesTotal: it.BytesTotal})
		} else {
			res.Active = true
			s.live.set(g.ID, Live{Phase: phaseOfItem(it.Phase), BytesTotal: it.BytesTotal, BytesLeft: it.BytesLeft, ETA: it.ETA})
		}
	}
	return res, errors.Join(errs...)
}

// markFailed moves a Grab to `failed` and records it.
func (s *Service) markFailed(ctx context.Context, g db.Grab, failure, now string) error {
	err := db.New(s.st.Write()).SetGrabState(ctx, db.SetGrabStateParams{
		State: "failed", Failure: sql.NullString{String: failure, Valid: true}, UpdatedAt: now, ID: g.ID,
	})
	if err != nil {
		return err
	}
	s.live.drop(g.ID)
	s.recordMove(ctx, g, "failed", failure)
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
		if err := s.dl.Remove(ctx, g.ClientInstanceID, g.ClientID, true); err != nil && !errors.Is(err, instances.ErrNotFound) {
			errs = append(errs, err)
		}
	}
	retried, err := s.retry(ctx, g)
	return retried, errors.Join(append(errs, err)...)
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
func (s *Service) retry(ctx context.Context, g db.Grab) ([]Grab, error) {
	if !g.TitleID.Valid || !g.VersionID.Valid {
		return nil, nil // the Title or Version was removed meanwhile
	}
	// A failed Upgrade leaves a Filled Version: its next best Release is the next Upgrade.
	out, err := s.searchTitle(ctx, g.TitleID.Int64, []int64{g.VersionID.Int64}, Scope{}, true, g.IsUpgrade == 1)
	if errors.Is(err, library.ErrNotFound) {
		return nil, nil
	}
	return out.Grabbed, err
}
