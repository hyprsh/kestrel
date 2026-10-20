package acquire

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/library"
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

// StartSearch checks the Version and scope as searchNow does, then runs
// searchNow in the background and returns at once. When the search is done it
// records a Searched event saying what came of it (each Grab records its own).
// The search lives as long as Kestrel does: StopSearches cancels it, and after
// StopSearches no search starts. This in-memory pool is ADR 0007's exception:
// a season or episode scope cannot be stored in search_state, so a restart
// forgets a search that had not finished.
func (s *Service) StartSearch(ctx context.Context, versionID int64, scope library.Scope) error {
	titleID, label, err := s.checkScope(ctx, versionID, scope)
	if err != nil {
		return err
	}
	s.searches.run(func(ctx context.Context) {
		out, err := s.searchTitle(ctx, titleID, []int64{versionID}, scope, false, false)
		// A search cancelled at shutdown still says so in the Log.
		ctx = context.WithoutCancel(ctx)
		s.hist.Record(ctx, history.Event{
			Kind: history.Searched, TitleID: titleID, VersionID: versionID, Message: s.searchedMessage(ctx, label, out, err),
		})
	})
	return nil
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

func (s *Service) searchedMessage(ctx context.Context, label string, out Outcome, err error) string {
	msg := "Searched by hand"
	if label != "" {
		msg += " for " + label
	}
	switch {
	case err != nil && len(out.Grabbed) == 0:
		return msg + " and failed: " + err.Error()
	case len(out.Grabbed) == 1:
		msg += ": grabbed 1 Release"
	case len(out.Grabbed) > 1:
		msg += fmt.Sprintf(": grabbed %d Releases", len(out.Grabbed))
	default:
		msg += ": nothing to grab"
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
