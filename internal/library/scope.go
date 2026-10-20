package library

import (
	"fmt"
	"slices"
)

// Scope narrows work on a Series Version (Search now, manual search, deleting
// files) to one season and, within it, to episodes. The zero Scope is the
// whole Series.
type Scope struct {
	Season     *int
	EpisodeIDs []int64
}

// ScopeError is a Scope that does not fit the Title. Field is "season" or
// "episode_ids"; Code is "unknown" (a season or episode the Series does not
// have) or "not_a_series" (a Movie, where the caller refuses a scope).
type ScopeError struct {
	Field, Code, Message string
}

func (e *ScopeError) Error() string { return e.Message }

// Check checks the scope against a Series' episodes: its season must be one
// of them, and its episodes the Series' (and the season's, when it names one).
func (sc Scope) Check(eps []Episode) error {
	if s := sc.Season; s != nil && !slices.ContainsFunc(eps, func(ep Episode) bool { return ep.Season == *s }) {
		return &ScopeError{Field: "season", Code: "unknown", Message: fmt.Sprintf("The Series has no season %d", *s)}
	}
	for _, id := range sc.EpisodeIDs {
		i := slices.IndexFunc(eps, func(ep Episode) bool { return ep.ID == id })
		if i < 0 || (sc.Season != nil && eps[i].Season != *sc.Season) {
			return &ScopeError{Field: "episode_ids", Code: "unknown", Message: fmt.Sprintf("Episode %d is not one of the Series' episodes in scope", id)}
		}
	}
	return nil
}

// Holds says whether the scope takes in the episode.
func (sc Scope) Holds(ep Episode) bool {
	if sc.Season != nil && ep.Season != *sc.Season {
		return false
	}
	return len(sc.EpisodeIDs) == 0 || slices.Contains(sc.EpisodeIDs, ep.ID)
}

// Narrow says whether the scope names a season or episodes.
func (sc Scope) Narrow() bool { return sc.Season != nil || len(sc.EpisodeIDs) > 0 }
