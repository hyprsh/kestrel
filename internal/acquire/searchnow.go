package acquire

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"sync"

	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/slot"
)

// searchNow is the search started by hand (Search now): the automatic search
// for what one Version is missing within scope, run at once. It grabs the best
// Release as the sweep would, but is not a sweep, so the 80 % budget stop does
// not apply; indexer pauses and backoff and Pause Grabs still do. A Series is
// searched once per season with a Wanted episode in scope; a Movie ignores the
// scope. It returns library.ErrNotFound for an unknown Version and a
// *library.ScopeError for a scope the Series does not have.
func (s *Service) searchNow(ctx context.Context, versionID int64, scope library.Scope) (Outcome, error) {
	titleID, _, err := s.checkScope(ctx, versionID, scope)
	if err != nil {
		return Outcome{}, err
	}
	return s.searchTitle(ctx, titleID, []int64{versionID}, scope, false, false)
}

// searchUpgradeNow is searchNow for an Upgrade: the automatic search for a better Release than the file the Version
// holds for the episodes within scope (or for a Movie), by the rules of the Upgrade sweep. It grabs only a Release the
// Profile ranks above the file and leaves episodes at their Cutoff, unmonitored or still downloading alone.
func (s *Service) searchUpgradeNow(ctx context.Context, versionID int64, scope library.Scope) (Outcome, error) {
	titleID, _, err := s.checkScope(ctx, versionID, scope)
	if err != nil {
		return Outcome{}, err
	}
	return s.searchTitle(ctx, titleID, []int64{versionID}, scope, false, true)
}

// Finished is what a search started by hand came to, for the caller's `finished` function.
type Finished struct {
	TitleID, VersionID int64
	// Title is the Title's name.
	Title string
	// Upgrade is set for an Upgrade search.
	Upgrade bool
	// End is how the search of the Version ended.
	End SearchEnd
	// Grabbed are the names of the Releases grabbed for the Version.
	Grabbed []string
	// Err is why the search failed, or nil.
	Err error
}

// finishedOf reads what the search of the Version came to.
func (s *Service) finishedOf(ctx context.Context, titleID, versionID int64, upgrade bool, out Outcome, err error) Finished {
	f := Finished{TitleID: titleID, VersionID: versionID, Upgrade: upgrade, End: s.endOf(ctx, out, versionID, err), Grabbed: []string{}}
	for _, g := range out.Grabbed {
		if g.VersionID == versionID {
			f.Grabbed = append(f.Grabbed, g.ReleaseName)
		}
	}
	if len(f.Grabbed) == 0 {
		f.Err = err
	}
	if d, derr := s.lib.Get(ctx, titleID, library.View{Now: s.clock()}); derr == nil {
		f.Title = d.Title
	}
	return f
}

// StartSearch checks the Version and scope as searchNow does, then runs
// searchNow in the background and returns at once. When the search is done it
// records a Searched event saying what came of it in the Version's Slot (each
// Grab records its own), then calls finished (when not nil) with what it found.
// The search lives as long as Kestrel does: StopSearches cancels it, and after
// StopSearches no search starts. This in-memory pool is ADR 0007's exception:
// a season or episode scope cannot be stored in search_state, so a restart
// forgets a search that had not finished.
func (s *Service) StartSearch(ctx context.Context, versionID int64, scope library.Scope, finished func(Finished)) error {
	titleID, label, err := s.checkScope(ctx, versionID, scope)
	if err != nil {
		return err
	}
	where, err := s.slotOf(ctx, titleID, versionID)
	if err != nil {
		return err
	}
	s.searches.run(func(ctx context.Context) {
		out, err := s.searchTitle(ctx, titleID, []int64{versionID}, scope, false, false)
		// A search cancelled at shutdown still says so in the Log.
		ctx = context.WithoutCancel(ctx)
		s.hist.Record(ctx, s.searchedEvent(ctx, "Searched by hand", titleID, versionID, label, where, out, err, nothingToGrab))
		if finished != nil {
			finished(s.finishedOf(ctx, titleID, versionID, false, out, err))
		}
	})
	return nil
}

const (
	nothingToGrab    = "nothing to grab"
	nothingToUpgrade = "nothing to upgrade"
	noBetterRelease  = "no better Release found"
)

// StartUpgradeSearch is StartSearch for an Upgrade: the Version's filled episodes within scope (or a filled Movie) are
// searched for a better Release. It reports started false when nothing in scope can be upgraded (every episode is at its
// Cutoff, unmonitored, not filled or being downloaded): no search runs, and the Log says "nothing to upgrade" at once.
// Otherwise the search runs in the background and the Log says what came of it, "no better Release found" included;
// finished (when not nil) is then called with what it found.
func (s *Service) StartUpgradeSearch(ctx context.Context, versionID int64, scope library.Scope, finished func(Finished)) (started bool, err error) {
	titleID, label, err := s.checkScope(ctx, versionID, scope)
	if err != nil {
		return false, err
	}
	where, err := s.slotOf(ctx, titleID, versionID)
	if err != nil {
		return false, err
	}
	const by = "Searched for Upgrades"
	can, err := s.upgradable(ctx, titleID, versionID, where, scope)
	if err != nil {
		return false, err
	}
	if !can {
		s.hist.Record(ctx, s.searchedEvent(ctx, by, titleID, versionID, label, where, Outcome{}, nil, nothingToUpgrade))
		return false, nil
	}
	s.searches.run(func(ctx context.Context) {
		out, err := s.searchTitle(ctx, titleID, []int64{versionID}, scope, false, true)
		ctx = context.WithoutCancel(ctx)
		nothing := noBetterRelease
		if !out.asked {
			nothing = nothingToUpgrade
		}
		s.hist.Record(ctx, s.searchedEvent(ctx, by, titleID, versionID, label, where, out, err, nothing))
		if finished != nil {
			finished(s.finishedOf(ctx, titleID, versionID, true, out, err))
		}
	})
	return true, nil
}

// upgradable says whether an Upgrade search of the Version within scope has anything to look for: a filled, monitored
// episode (or Movie) below its Profile's Cutoff with no Grab running for it.
func (s *Service) upgradable(ctx context.Context, titleID, versionID int64, where Slot, scope library.Scope) (bool, error) {
	sub, err := s.subjectOf(ctx, titleID)
	if err != nil {
		return false, err
	}
	if sub.detail.Kind == library.Series {
		eps, err := s.lib.Episodes(ctx, titleID, library.View{Now: s.clock()})
		if err != nil {
			return false, err
		}
		covered, err := s.coveredEpisodes(ctx)
		if err != nil {
			return false, err
		}
		for _, ep := range eps {
			cell := ep.Cells[where]
			if cell == nil || cell.State != library.Filled || covered[[2]int64{versionID, ep.ID}] || !ep.Monitored || !scope.Holds(ep) {
				continue
			}
			if !cellHeld(cell, sub.versions[where]).Done {
				return true, nil
			}
		}
		return false, nil
	}
	busy, err := s.busyVersions(ctx)
	if err != nil {
		return false, err
	}
	for _, v := range sub.detail.Versions {
		if v.ID != versionID || !searchable(sub.detail, v, library.Filled, s.clock()) || busy[v.ID] {
			continue
		}
		return v.File == nil || !fileHeld(v.File, sub.versions[v.Slot]).Done, nil
	}
	return false, nil
}

// StopSearches is the shutdown of the searches started by StartSearch: it
// cancels those running, waits for them to end and starts none after. Kestrel
// calls it when its loops stop, before the store closes.
func (s *Service) StopSearches() { s.searches.stop() }

// checkScope finds the Version's Title and checks the scope against its
// episodes. It returns how the scope reads in the Log ("" for all of it).
func (s *Service) checkScope(ctx context.Context, versionID int64, scope library.Scope) (titleID int64, label string, err error) {
	titleID, err = s.lib.TitleOfVersion(ctx, versionID)
	if err != nil {
		return 0, "", err
	}
	eps, err := s.lib.Episodes(ctx, titleID, library.View{Now: s.clock()})
	if errors.Is(err, library.ErrNotASeries) {
		return titleID, "", nil // a Movie ignores the scope
	}
	if err != nil {
		return 0, "", err
	}
	if err := scope.Check(eps); err != nil {
		return 0, "", err
	}
	var named []library.Episode
	for _, ep := range eps {
		if len(scope.EpisodeIDs) > 0 && scope.Holds(ep) {
			named = append(named, ep)
		}
	}
	switch {
	case len(named) == 1:
		label = fmt.Sprintf("S%02dE%02d", named[0].Season, named[0].Number)
	case len(named) > 1:
		label = fmt.Sprintf("%d episodes", len(named))
	case scope.Season != nil && *scope.Season == 0:
		label = "Specials"
	case scope.Season != nil:
		label = fmt.Sprintf("Season %d", *scope.Season)
	}
	return titleID, label, nil
}

// slotOf is the Slot of one of the Title's Versions.
func (s *Service) slotOf(ctx context.Context, titleID, versionID int64) (Slot, error) {
	d, err := s.lib.Get(ctx, titleID, library.View{Now: s.clock()})
	if err != nil {
		return "", err
	}
	for _, v := range d.Versions {
		if v.ID == versionID {
			return v.Slot, nil
		}
	}
	return "", library.ErrNotFound
}

// searchedEvent is the routine Searched event of one Version's search: by says who searched ("Searched by hand",
// "Searched"), label the scope ("" for all of it) and nothing what a search that grabbed nothing says ("nothing to grab").
func (s *Service) searchedEvent(ctx context.Context, by string, titleID, versionID int64, label string, where Slot, out Outcome, err error, nothing string) history.Event {
	stored := s.storedSlots(ctx)
	own := out
	own.Grabbed = nil
	for _, g := range out.Grabbed {
		if g.VersionID == versionID {
			own.Grabbed = append(own.Grabbed, g)
		}
	}
	return history.Event{
		Kind: history.Searched, TitleID: titleID, VersionID: versionID, Message: s.searchedMessage(ctx, by, label, slot.Label(stored, where), own, err, nothing),
		Data: searchedData(label, slot.Label(stored, where), own, s.endOf(ctx, out, versionID, err)),
	}
}

// noteAutomatic writes the Searched event of each Version an automatic search (the sweeps, the search on add and the
// Upgrade sweep) asked the indexers for. They are routine, so the Log folds them and they are pruned after 30 days;
// one event per Version searched keeps the volume to what the schedule allows (a day, three days, seven days, then
// weekly).
func (s *Service) noteAutomatic(ctx context.Context, titleID int64, upgrade bool, out Outcome, err error) {
	if !out.asked || ctx.Err() != nil {
		return
	}
	d, derr := s.lib.Get(ctx, titleID, library.View{Now: s.clock()})
	if derr != nil {
		return
	}
	by := "Searched"
	if upgrade {
		by = "Searched for Upgrades"
	}
	for _, v := range d.Versions {
		if slices.Contains(out.Searched, v.ID) {
			s.hist.Record(ctx, s.searchedEvent(ctx, by, titleID, v.ID, "", v.Slot, out, err, nothingToGrab))
		}
	}
}

// searchedData is the Searched event's payload: what the search covered and found, for the Log's fold ("418 releases
// checked") and its lines ("37 releases · 1 Grab"). Releases is how many came back for the Title, grabbed how many
// Grabs the search made and result how it ended for the Version.
func searchedData(label, slotLabel string, out Outcome, end SearchEnd) json.RawMessage {
	b, _ := json.Marshal(map[string]any{"scope": label, "slot": slotLabel, "releases": out.Releases, "grabbed": len(out.Grabbed), "result": end})
	return b
}

// searchedMessage says what a search by hand came to, naming the scope and the
// Slot so two Versions' searches read apart: "Searched by hand for S01E02 in
// 4K: grabbed 1 Release" (by is "Searched by hand").
func (s *Service) searchedMessage(ctx context.Context, by, label, where string, out Outcome, err error, nothing string) string {
	msg := by
	if label != "" {
		msg += " for " + label
	}
	msg += " in " + where
	switch {
	case err != nil && len(out.Grabbed) == 0:
		return msg + " and failed: " + err.Error()
	case len(out.Grabbed) == 1:
		msg += ": grabbed 1 Release"
	case len(out.Grabbed) > 1:
		msg += fmt.Sprintf(": grabbed %d Releases", len(out.Grabbed))
	default:
		msg += ": " + nothing
		if s.pause != nil {
			if paused, _ := s.pause.Paused(ctx); paused {
				msg += " while Grabs are paused"
			}
		}
	}
	if n := len(out.Failures); n == 1 {
		msg += "; 1 indexer did not answer"
	} else if n > 1 {
		msg += fmt.Sprintf("; %d indexers did not answer", n)
	}
	return msg
}

// background runs functions in their own goroutines, at most n at a time,
// under a context that stop cancels.
type background struct {
	sem    chan struct{}
	ctx    context.Context
	cancel context.CancelFunc

	mu      sync.Mutex // guards stopped and the WaitGroup's Add against stop's Wait
	stopped bool
	wg      sync.WaitGroup
}

func newBackground(n int) *background {
	ctx, cancel := context.WithCancel(context.Background())
	return &background{sem: make(chan struct{}, n), ctx: ctx, cancel: cancel}
}

// run starts f, unless the pool has stopped.
func (b *background) run(f func(ctx context.Context)) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.stopped {
		return
	}
	b.wg.Add(1)
	go func() {
		defer b.wg.Done()
		select {
		case b.sem <- struct{}{}:
		case <-b.ctx.Done():
			return
		}
		defer func() { <-b.sem }()
		f(b.ctx)
	}()
}

// stop cancels what runs, waits for it and refuses more.
func (b *background) stop() {
	b.mu.Lock()
	b.stopped = true
	b.mu.Unlock()
	b.cancel()
	b.wg.Wait()
}
