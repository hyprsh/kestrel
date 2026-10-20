package acquire

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"sync"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire/db"
	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/indexers"
	"github.com/hyprsh/kestrel/internal/library"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
)

// Phase is what a Grab in "Downloading now" is doing.
type Phase string

const (
	PhaseQueued         Phase = "queued"
	PhaseDownloading    Phase = "downloading"
	PhasePaused         Phase = "paused"
	PhasePostProcessing Phase = "post_processing"
	// PhaseImporting is a finished download waiting for, or in, its Import.
	PhaseImporting Phase = "importing"
)

// Live is what the download client last said about a Grab. It lives in memory
// only and is rebuilt by the next poll after a restart.
type Live struct {
	Phase      Phase
	BytesTotal int64
	BytesLeft  int64
	// ETA is 0 when the client does not know.
	ETA time.Duration
}

// Active is a Grab that shows in "Downloading now".
type Active struct {
	Grab
	Live
}

type liveSet struct {
	mu sync.Mutex
	m  map[int64]Live
}

func (l *liveSet) get(id int64) (Live, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	v, ok := l.m[id]
	return v, ok
}

func (l *liveSet) set(id int64, v Live) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.m[id] = v
}

func (l *liveSet) drop(id int64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.m, id)
}

// Active lists the Grabs that are sent, downloading or finished and waiting
// for Import (not stalled ones), oldest first, each with what the client last
// said. Before the first poll a Grab's phase follows from its state alone.
func (s *Service) Active(ctx context.Context) ([]Active, error) {
	rows, err := db.New(s.st.Read()).ListActiveGrabs(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Active, 0, len(rows))
	for _, r := range rows {
		g := grabOf(r)
		live, ok := s.live.get(g.ID)
		if !ok || g.State == "completed" || g.State == "importing" {
			live = Live{Phase: phaseOfState(g.State), BytesTotal: live.BytesTotal}
		}
		out = append(out, Active{Grab: g, Live: live})
	}
	return out, nil
}

func phaseOfState(state string) Phase {
	switch state {
	case "downloading":
		return PhaseDownloading
	case "completed", "importing":
		return PhaseImporting
	}
	return PhaseQueued
}

// recordMove records a Grab's move to a new state, for the Log and the live UI.
func (s *Service) recordMove(ctx context.Context, g db.Grab, state, failure string) {
	ev := history.Event{TitleID: g.TitleID.Int64, VersionID: g.VersionID.Int64, GrabID: g.ID}
	switch state {
	case "downloading":
		ev.Kind, ev.Message = history.GrabDownloading, "Download started: "+g.ReleaseName
	case "completed":
		ev.Kind, ev.Message = history.GrabCompleted, "Download finished: "+g.ReleaseName
	case "failed":
		ev.Kind, ev.Message = history.GrabFailed, "Download failed ("+failure+"): "+g.ReleaseName
	default:
		return
	}
	s.hist.Record(ctx, ev)
}

func phaseOfItem(p downloadclient.Phase) Phase {
	switch p {
	case downloadclient.PhaseDownloading:
		return PhaseDownloading
	case downloadclient.PhasePaused:
		return PhasePaused
	case downloadclient.PhasePostProcessing:
		return PhasePostProcessing
	}
	return PhaseQueued
}

// CancelVersions cancels the active Grabs of the Versions, their client jobs
// with them. Canceled Grabs are not blocklisted.
func (s *Service) CancelVersions(ctx context.Context, versionIDs ...int64) error {
	active, err := s.Active(ctx)
	if err != nil {
		return err
	}
	for _, a := range active {
		if slices.Contains(versionIDs, a.VersionID) {
			if _, err := s.Cancel(ctx, a.ID, false); err != nil {
				return err
			}
		}
	}
	return nil
}

// Cancel stops a Grab: its job leaves the download client (files included),
// the Grab row goes and the Version is Wanted again. With blocklist the
// Release also goes on the Blocklist and the next best Release is grabbed. It returns the Grab as it was, or
// ErrGrabNotFound.
func (s *Service) Cancel(ctx context.Context, id int64, blocklist bool) (Grab, error) {
	row, err := db.New(s.st.Read()).GetGrab(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return Grab{}, ErrGrabNotFound
	}
	if err != nil {
		return Grab{}, err
	}
	g := grabOf(row)
	if err := s.dl.Remove(ctx, row.ClientInstanceID, row.ClientID, true); err != nil && !errors.Is(err, instances.ErrNotFound) {
		return Grab{}, err
	}
	if blocklist {
		err = s.Block(ctx, BlockEntry{
			ReleaseName: g.ReleaseName, IndexerID: row.IndexerID, GUID: row.ReleaseGuid, PublishedAt: g.PublishedAt, Size: g.Size,
			Reason: "canceled and blocklisted", TitleID: g.TitleID, VersionID: g.VersionID,
		})
		if err != nil {
			return Grab{}, err
		}
	}
	if err := db.New(s.st.Write()).DeleteGrab(ctx, id); err != nil {
		return Grab{}, err
	}
	s.live.drop(id)
	s.hist.Record(ctx, history.Event{
		Kind: history.GrabCanceled, TitleID: g.TitleID, VersionID: g.VersionID, Message: "Canceled " + g.ReleaseName,
	})
	if blocklist {
		// The Release is out: take the next best one at once. A retry that finds
		// nothing, or fails, leaves the Version Wanted for the sweep.
		_, _ = s.retry(ctx, row)
	}
	return g, nil
}

// Outcome is what SearchWanted did.
type Outcome struct {
	// Searched are the Versions that were searched for.
	Searched []int64
	// Grabbed are the Grabs it made.
	Grabbed []Grab
	// Failures are the indexers that could not answer fully.
	Failures []indexers.Failure
}

// SearchWanted is the automatic search for what a Title's Versions are
// missing (the missing sweep and retries): one search of the indexers, then
// Decide picks the best Release for each Wanted Version and Grabs it. Only
// Versions in versionIDs that are Wanted and have no active Grab are
// searched; with none left nothing is asked of the indexers. Grabs that
// fail to send are joined into the error, and the Versions still count as
// searched.
func (s *Service) SearchWanted(ctx context.Context, titleID int64, versionIDs []int64) (Outcome, error) {
	ctx = indexers.WithSweep(ctx)
	if !s.idx.CanSweep(ctx) {
		return Outcome{}, nil // nothing was searched: the Versions stay due
	}
	return s.searchTitle(ctx, titleID, versionIDs, library.Scope{}, false, false)
}

// SearchNew is the search on add: the first search of a new Version (added by
// hand or by a Request). It does what SearchWanted does but is not a sweep, so
// the 80 % budget stop does not apply to it.
func (s *Service) SearchNew(ctx context.Context, titleID int64, versionIDs []int64) (Outcome, error) {
	return s.searchTitle(ctx, titleID, versionIDs, library.Scope{}, false, false)
}

// SearchUpgrades is the Upgrade sweep's search: the same as SearchWanted for
// the Filled Versions among versionIDs, with the files they hold as the bar
// a Release has to clear (Decide's Upgrade threshold). It grabs nothing that
// does not beat what is held.
func (s *Service) SearchUpgrades(ctx context.Context, titleID int64, versionIDs []int64) (Outcome, error) {
	ctx = indexers.WithSweep(ctx)
	if !s.idx.CanSweep(ctx) {
		return Outcome{}, nil
	}
	return s.searchTitle(ctx, titleID, versionIDs, library.Scope{}, false, true)
}

// searchTitle searches a Title for its Wanted Versions, or with upgrade for its
// Filled ones. A Series is searched within scope; a Movie ignores it.
func (s *Service) searchTitle(ctx context.Context, titleID int64, versionIDs []int64, scope library.Scope, fromCache, upgrade bool) (Outcome, error) {
	defer s.snap.Hold()()
	sub, err := s.subjectOf(ctx, titleID)
	if err != nil {
		return Outcome{}, err
	}
	want := library.Wanted
	if upgrade {
		want = library.Filled
	}
	if sub.detail.Kind == library.Series {
		return s.searchSeries(ctx, sub, versionIDs, scope, fromCache, upgrade)
	}
	busy, err := s.busyVersions(ctx)
	if err != nil {
		return Outcome{}, err
	}
	var out Outcome
	var in Input
	slotVersion := map[Slot]int64{}
	for _, v := range sub.detail.Versions {
		if !slices.Contains(versionIDs, v.ID) || v.State != want || busy[v.ID] {
			continue
		}
		out.Searched = append(out.Searched, v.ID)
		slotVersion[v.Slot] = v.ID
		u := Unit{}
		if upgrade && v.File != nil {
			h := Held{Fits: true}
			if v.File.Score != nil {
				h.Score = *v.File.Score
			}
			u.Held = &h
		}
		in.Versions = append(in.Versions, Version{Slot: v.Slot, Units: []Unit{u}})
	}
	if len(in.Versions) == 0 {
		return out, nil
	}
	entries, failures, err := s.candidates(ctx, sub, library.Scope{}, fromCache)
	if err != nil {
		return out, err
	}
	out.Failures = failures
	byRelease := map[string]*entry{}
	for _, e := range entries {
		in.Candidates = append(in.Candidates, e.cand)
		byRelease[e.cand.GUID+"\x00"+e.cand.IndexerID] = e
	}
	plans, err := s.decide(ctx, in)
	if err != nil {
		return out, err
	}
	var errs []error
	for _, plan := range plans {
		e := byRelease[plan.Candidate.GUID+"\x00"+plan.Candidate.IndexerID]
		if e == nil {
			continue
		}
		g, err := s.grab(ctx, slotVersion[plan.Slot], e.id, false)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		out.Grabbed = append(out.Grabbed, g)
	}
	return out, errors.Join(errs...)
}
