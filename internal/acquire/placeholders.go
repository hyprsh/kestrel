package acquire

import (
	"context"
	"slices"
	"time"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
)

// This file holds what acquire does about Placeholder Episodes (ADR 0013):
// episodes a Release names before TheTVDB lists them. The rule for which
// qualify is the library's (library.UnlistedOf).

const (
	// RejectEpisodeNotListed says a Release names an episode TheTVDB does not
	// list that may not get a Placeholder Episode, for instance one beyond the
	// limit. A Grab by hand may override it, which adds the Placeholder Episode.
	RejectEpisodeNotListed scoring.Rejection = "episode_not_listed"
	// RejectSeasonNotListed says a Release names a season TheTVDB does not
	// list. It is never overridable.
	RejectSeasonNotListed scoring.Rejection = "season_not_listed"
)

// namedEpisodes are the season and episodes a single or multi-episode Series
// Release names; false for a Movie, a pack or a Release Decide never plans
// (absolute or unresolved daily numbering, several seasons).
func namedEpisodes(p release.ParsedRelease) (int, []int, bool) {
	s := p.Series
	if s == nil || p.IsAbsoluteNumbering() || p.IsDaily() || s.MultiSeason || s.FullSeason || s.PartialSeason || s.SeasonExtra {
		return 0, nil, false
	}
	return s.Season, s.Episodes, len(s.Episodes) > 0
}

// unlistedReasons is the rejection a Release gets in manual search for naming
// episodes TheTVDB does not list that do not qualify; none when they do (a
// Grab adds them) or it names none.
func unlistedReasons(d library.Detail, eps []library.Episode, p release.ParsedRelease, now time.Time) []scoring.Rejection {
	season, numbers, ok := namedEpisodes(p)
	if !ok {
		return nil
	}
	switch _, why := library.UnlistedOf(d, eps, season, numbers, now); why {
	case library.EpisodeNotListed:
		return []scoring.Rejection{RejectEpisodeNotListed}
	case library.SeasonNotListed:
		return []scoring.Rejection{RejectSeasonNotListed}
	}
	return nil
}

// planUnlisted gives each Version of in a Unit for every unlisted episode a
// candidate names that qualifies for a Placeholder Episode, and marks the
// candidates naming one that does not. A scope narrowed to episodes takes in
// no unlisted one; one narrowed to a season, only that season's.
func planUnlisted(in *Input, d library.Detail, eps []library.Episode, now time.Time, scope library.Scope) {
	var refs []EpisodeRef
	for i := range in.Candidates {
		c := &in.Candidates[i]
		season, numbers, ok := namedEpisodes(c.Parsed)
		if !ok {
			continue
		}
		unlisted, why := library.UnlistedOf(d, eps, season, numbers, now)
		if why != library.Qualifies {
			c.Unqualified = true
			continue
		}
		for _, r := range unlisted {
			ref := EpisodeRef{r.Season, r.Number}
			inScope := len(scope.EpisodeIDs) == 0 && (scope.Season == nil || *scope.Season == r.Season)
			if inScope && !slices.Contains(refs, ref) {
				refs = append(refs, ref)
			}
		}
	}
	for i := range in.Versions {
		for _, r := range refs {
			in.Versions[i].Units = append(in.Versions[i].Units, Unit{Ref: r, Unlisted: true})
		}
	}
}

// placeholdersFor adds a Placeholder Episode for each of refs the Series has no
// episode for, and returns the Series' episodes with them, so a Grab can cover
// them like any episode.
func (s *Service) placeholdersFor(ctx context.Context, titleID int64, refs []EpisodeRef, eps []library.Episode) ([]library.Episode, error) {
	var add []library.EpisodeRef
	for _, r := range refs {
		if episodeID(eps, r) == 0 {
			add = append(add, library.EpisodeRef{Season: r.Season, Number: r.Episode})
		}
	}
	if len(add) == 0 {
		return eps, nil
	}
	if err := s.lib.AddPlaceholders(ctx, titleID, add); err != nil {
		return nil, err
	}
	return s.lib.Episodes(ctx, titleID, library.View{Now: s.clock()})
}

// placeholdersNamed is placeholdersFor every episode a Release names that the
// Series has none for: a Grab by hand, its rejections already checked.
func (s *Service) placeholdersNamed(ctx context.Context, titleID int64, p release.ParsedRelease, eps []library.Episode) ([]library.Episode, error) {
	season, numbers, ok := namedEpisodes(p)
	if !ok {
		return eps, nil
	}
	refs := make([]EpisodeRef, len(numbers))
	for i, n := range numbers {
		refs[i] = EpisodeRef{season, n}
	}
	return s.placeholdersFor(ctx, titleID, refs, eps)
}

// seriesEpisodes are a Series' episodes; nil for a Movie.
func (s *Service) seriesEpisodes(ctx context.Context, d library.Detail) ([]library.Episode, error) {
	if d.Kind != library.Series {
		return nil, nil
	}
	return s.lib.Episodes(ctx, d.ID, library.View{Now: s.clock()})
}

// episodeID is the id of the episode at ref; 0 when there is none.
func episodeID(eps []library.Episode, ref EpisodeRef) int64 {
	for _, ep := range eps {
		if ep.Season == ref.Season && ep.Number == ref.Episode {
			return ep.ID
		}
	}
	return 0
}
