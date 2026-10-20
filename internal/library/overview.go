package library

import (
	"fmt"
	"slices"
	"sort"
	"time"

	"github.com/hyprsh/kestrel/internal/metadata"
)

// SeasonOverview is one season of a Series as the add panel lists it.
type SeasonOverview struct {
	Number   int // 0 is Specials
	Episodes int
	// FirstAired and LastAired are the season's earliest and latest known air
	// dates, the latter possibly in the future; nil when no episode has one.
	FirstAired, LastAired *time.Time
}

// SeriesOverview is a Series' seasons as TheTVDB lists them, read before it is
// added.
type SeriesOverview struct {
	// FirstAired is the first air date and LastAired the latest one up to
	// today, Specials aside; nil when there is none.
	FirstAired, LastAired *time.Time
	// Latest is the latest season that has aired or is airing, Specials
	// aside; 0 when none has started.
	Latest  int
	Seasons []SeasonOverview // in season order, Specials first
}

// SummariseSeasons summarises a Series' episodes per season at now.
func SummariseSeasons(eps []metadata.Episode, now time.Time) SeriesOverview {
	var out SeriesOverview
	at := map[int]int{} // season -> index in out.Seasons
	today := dayOf(now)
	for _, e := range eps {
		i, ok := at[e.Season]
		if !ok {
			i = len(out.Seasons)
			at[e.Season] = i
			out.Seasons = append(out.Seasons, SeasonOverview{Number: e.Season})
		}
		s := &out.Seasons[i]
		s.Episodes++
		if e.Aired == nil {
			continue
		}
		s.FirstAired, s.LastAired = earlier(s.FirstAired, e.Aired), later(s.LastAired, e.Aired)
		if e.Season == 0 {
			continue
		}
		out.FirstAired = earlier(out.FirstAired, e.Aired)
		if !e.Aired.After(today) {
			out.LastAired = later(out.LastAired, e.Aired)
			out.Latest = max(out.Latest, e.Season)
		}
	}
	sort.Slice(out.Seasons, func(i, j int) bool { return out.Seasons[i].Number < out.Seasons[j].Number })
	return out
}

// UnknownSeasonError refuses seasons to monitor at add that the Series does
// not have.
type UnknownSeasonError struct{ Season int }

func (e *UnknownSeasonError) Error() string {
	return fmt.Sprintf("library: the Series has no season %d", e.Season)
}

// checkSeasons is an *UnknownSeasonError for the first of seasons the
// episodes do not cover.
func checkSeasons(seasons []int, eps []metadata.Episode) error {
	for _, n := range seasons {
		if !slices.ContainsFunc(eps, func(e metadata.Episode) bool { return e.Season == n }) {
			return &UnknownSeasonError{Season: n}
		}
	}
	return nil
}

// monitorsAtAdd is whether an episode is monitored when its Series is added.
// Without Seasons the mode decides. With them, the named seasons are monitored
// and the others are not, except that the mode still decides seasons that have
// not started airing: those are the new seasons it is about.
func (a AddSeries) monitorsAtAdd(e metadata.Episode, started map[int]bool, now time.Time) bool {
	if a.Seasons == nil {
		return a.Monitor.MonitorsEpisode(e.Season, e.Aired, now)
	}
	if slices.Contains(a.Seasons, e.Season) {
		return true
	}
	return !started[e.Season] && a.Monitor.MonitorsEpisode(e.Season, e.Aired, now)
}

// startedSeasons are the seasons with an episode that aired by now.
func startedSeasons(eps []metadata.Episode, now time.Time) map[int]bool {
	today := dayOf(now)
	out := map[int]bool{}
	for _, e := range eps {
		if e.Aired != nil && !e.Aired.After(today) {
			out[e.Season] = true
		}
	}
	return out
}

func earlier(a, b *time.Time) *time.Time {
	if a == nil || b.Before(*a) {
		return b
	}
	return a
}

func later(a, b *time.Time) *time.Time {
	if a == nil || b.After(*a) {
		return b
	}
	return a
}
