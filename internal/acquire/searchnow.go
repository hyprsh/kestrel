package acquire

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sync"

	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/library"
)

// ScopeError is a Scope that does not fit the Series: Field is "season" or
// "episode_ids".
type ScopeError struct {
	Field   string
	Message string
}

func (e *ScopeError) Error() string { return e.Message }

// SearchNow is the search started by hand (Search now): the automatic search
// for what one Version is missing within scope, run at once. It grabs the best
// Release as the sweep would, but is not a sweep, so the 80 % budget stop does
// not apply; indexer pauses and backoff and Pause Grabs still do. A Series is
// searched once per season with a Wanted episode in scope; a Movie ignores the
// scope. It returns library.ErrNotFound for an unknown Version and a
// *ScopeError for a scope the Series does not have.
func (s *Service) SearchNow(ctx context.Context, versionID int64, scope Scope) (Outcome, error) {
	titleID, _, err := s.checkScope(ctx, versionID, scope)
	if err != nil {
		return Outcome{}, err
	}
	return s.searchTitle(ctx, titleID, []int64{versionID}, scope, false, false)
}

// StartSearch checks the Version and scope as SearchNow does, then runs
// SearchNow in the background and returns at once. When the search is done it
// records a Searched event saying what came of it (each Grab records its own).
func (s *Service) StartSearch(ctx context.Context, versionID int64, scope Scope) error {
	titleID, label, err := s.checkScope(ctx, versionID, scope)
	if err != nil {
		return err
	}
	s.searches.run(func() {
		ctx := context.Background()
		out, err := s.searchTitle(ctx, titleID, []int64{versionID}, scope, false, false)
		s.hist.Record(ctx, history.Event{
			Kind: history.Searched, TitleID: titleID, VersionID: versionID, Message: s.searchedMessage(ctx, label, out, err),
		})
	})
	return nil
}

// WaitSearches blocks until every search started by StartSearch has finished.
func (s *Service) WaitSearches() { s.searches.wait() }

// checkScope finds the Version's Title and checks the scope against its
// episodes. It returns how the scope reads in the Log ("" for all of it).
func (s *Service) checkScope(ctx context.Context, versionID int64, scope Scope) (titleID int64, label string, err error) {
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
	if sc := scope.Season; sc != nil && !slices.ContainsFunc(eps, func(ep library.Episode) bool { return ep.Season == *sc }) {
		return 0, "", &ScopeError{Field: "season", Message: fmt.Sprintf("The Series has no season %d", *sc)}
	}
	var named []library.Episode
	for _, id := range scope.EpisodeIDs {
		i := slices.IndexFunc(eps, func(ep library.Episode) bool { return ep.ID == id })
		if i < 0 || (scope.Season != nil && eps[i].Season != *scope.Season) {
			return 0, "", &ScopeError{Field: "episode_ids", Message: fmt.Sprintf("Episode %d is not one of the Series' episodes in scope", id)}
		}
		named = append(named, eps[i])
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

// background runs functions in their own goroutines, at most n at a time.
type background struct {
	sem chan struct{}
	wg  sync.WaitGroup
}

func newBackground(n int) *background { return &background{sem: make(chan struct{}, n)} }

func (b *background) run(f func()) {
	b.wg.Add(1)
	go func() {
		defer b.wg.Done()
		b.sem <- struct{}{}
		defer func() { <-b.sem }()
		f()
	}()
}

func (b *background) wait() { b.wg.Wait() }
