package acquire

import (
	"context"
	"errors"
	"slices"
	"strconv"

	"github.com/hyprsh/kestrel/internal/downloads"
	"github.com/hyprsh/kestrel/internal/indexers"
	"github.com/hyprsh/kestrel/internal/library"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
)

// scopeQuery returns the season and episode strings an indexer is asked for
// in a scoped search. RSS and the sweeps reuse the same season searches.
func scopeQuery(sc library.Scope, eps []library.Episode) (season, episode string) {
	if sc.Season == nil {
		return "", ""
	}
	season = strconv.Itoa(*sc.Season)
	if len(sc.EpisodeIDs) == 1 {
		for _, ep := range eps {
			if ep.ID == sc.EpisodeIDs[0] && ep.Season == *sc.Season {
				episode = strconv.Itoa(ep.Number)
			}
		}
	}
	return season, episode
}

// scopeWants says whether a parsed Series release is about the scoped season
// and episodes: a single or multi-episode release naming one of them, or a pack
// of the season.
func scopeWants(sc library.Scope, p release.ParsedRelease, eps []library.Episode) bool {
	s := p.Series
	if sc.Season == nil || s == nil {
		return true
	}
	if s.MultiSeason {
		return true
	}
	if s.Season != *sc.Season {
		return false
	}
	if len(sc.EpisodeIDs) == 0 || s.FullSeason {
		return true
	}
	for _, ep := range eps {
		if slices.Contains(sc.EpisodeIDs, ep.ID) && ep.Season == s.Season && slices.Contains(s.Episodes, ep.Number) {
			return true
		}
	}
	return false
}

// gatherSeries is gather for a Series: it asks the indexers by TheTVDB id
// (then by title), keeps the Releases that name this Series (and the scoped
// season or episodes) and scores each under every Version's Profile.
func (s *Service) gatherSeries(ctx context.Context, sub subject, scope library.Scope) ([]*entry, []indexers.Failure, error) {
	d := sub.detail
	now := s.clock()
	episodes, err := s.lib.Episodes(ctx, d.ID, library.View{Now: now})
	if err != nil {
		return nil, nil, err
	}
	season, episode := scopeQuery(scope, episodes)
	res := s.idx.Search(ctx, indexers.Query{
		Media: indexer.MediaTV, IMDBID: d.IMDbID, TVDBID: d.TVDBID,
		Titles: searchTitles(d.Title, d.OriginalTitle, d.PrimaryTitle), Season: season, Episode: episode,
	})
	names := map[string]bool{}
	for _, n := range []string{d.Title, d.OriginalTitle, d.PrimaryTitle} {
		names[normalize(n)] = true
	}
	for _, a := range d.Aliases {
		names[normalize(a.Title)] = true
	}

	var out []*entry
	for _, r := range res.Releases {
		parsed, err := release.Parse(r.Title, release.KindSeries)
		if err != nil {
			continue // not a name that can be read
		}
		if !r.ByID && !slices.ContainsFunc(parsedTitles(parsed), func(t string) bool { return names[normalize(t)] }) {
			continue // a text hit for some other Series
		}
		parsed, ok := resolveDaily(parsed, episodes)
		if !ok || !scopeWants(scope, parsed, episodes) {
			continue
		}
		title := scoring.Title{
			Name: d.Title, Year: d.Year, OriginalLanguage: release.LanguageByISO(d.OriginalLanguage),
			EpisodeTitles: episodeTitles(parsed, episodes),
		}
		e, err := s.entryFor(ctx, sub, r, parsed, title, now)
		if err != nil {
			return nil, nil, err
		}
		out = append(out, e)
	}
	s.cache.put(now, out)
	return out, res.Failures, nil
}

// coveredBy are the episodes a Series Release holds that the library knows,
// and whether the Version in slot already has a file for any of them.
func coveredBy(p release.ParsedRelease, eps []library.Episode, slot Slot) (ids []int64, upgrade bool) {
	s := p.Series
	if s == nil {
		return nil, false
	}
	for _, ep := range eps {
		in := false
		switch {
		case s.MultiSeason:
			in = ep.Season >= s.Season
		case ep.Season != s.Season:
		case s.FullSeason:
			in = true
		default:
			in = slices.Contains(s.Episodes, ep.Number)
		}
		if !in {
			continue
		}
		ids = append(ids, ep.ID)
		if c := ep.Cells[slot]; c != nil && c.State == library.Filled {
			upgrade = true
		}
	}
	return ids, upgrade
}

// inSeason is the scope's search of one season: the season, with the scope's
// episodes of it.
func inSeason(sc library.Scope, season int, eps []library.Episode) library.Scope {
	out := library.Scope{Season: &season}
	for _, ep := range eps {
		if ep.Season == season && slices.Contains(sc.EpisodeIDs, ep.ID) {
			out.EpisodeIDs = append(out.EpisodeIDs, ep.ID)
		}
	}
	return out
}

// searchSeries is SearchWanted for a Series: one search per season that has a
// Wanted episode in a requested Version (Specials are never searched on their
// own unless the scope names them), then one Decide over everything found, so
// a finished season takes its pack and a running one its episodes. Only the
// episodes within scope count.
//
// With upgrade it is the Upgrade sweep: the Filled Versions, with their files as
// the bar to clear, season by season.
func (s *Service) searchSeries(ctx context.Context, sub subject, versionIDs []int64, scope library.Scope, fromCache, upgrade bool) (Outcome, error) {
	d := sub.detail
	var out Outcome
	now := s.clock()
	episodes, err := s.lib.Episodes(ctx, d.ID, library.View{Now: now})
	if err != nil {
		return out, err
	}
	covered, err := s.coveredEpisodes(ctx)
	if err != nil {
		return out, err
	}

	want := library.Wanted
	if upgrade {
		want = library.Filled
	}
	var in Input
	in.SeasonsFinished = seasonsFinished(episodes, now)
	versionOf := map[Slot]int64{}
	wantedSeasons := map[int]bool{}
	for _, v := range d.Versions {
		if !slices.Contains(versionIDs, v.ID) || v.State != want {
			continue
		}
		ver := Version{Slot: v.Slot}
		for _, ep := range episodes {
			cell := ep.Cells[v.Slot]
			if cell == nil || cell.State != want || covered[[2]int64{v.ID, ep.ID}] || (upgrade && !ep.Monitored) || !scope.Holds(ep) {
				continue
			}
			u := Unit{Ref: EpisodeRef{ep.Season, ep.Number}}
			if upgrade {
				h := Held{Fits: true, Original: cell.File != nil && cell.File.Original}
				if cell.Score != nil {
					h.Score = *cell.Score
				}
				u.Held = &h
			}
			ver.Units = append(ver.Units, u)
			if ep.Season != 0 || scope.Narrow() {
				wantedSeasons[ep.Season] = true
			}
		}
		out.Searched = append(out.Searched, v.ID)
		if len(ver.Units) > 0 {
			versionOf[v.Slot] = v.ID
			in.Versions = append(in.Versions, ver)
		}
	}
	if len(in.Versions) == 0 {
		return out, nil
	}

	seasons := make([]int, 0, len(wantedSeasons))
	for n := range wantedSeasons {
		seasons = append(seasons, n)
	}
	slices.Sort(seasons)
	entries := map[string]*entry{}
	add := func(found []*entry) {
		for _, e := range found {
			if _, seen := entries[entryKey(e.cand)]; !seen {
				entries[entryKey(e.cand)] = e
				in.Candidates = append(in.Candidates, e.cand)
			}
		}
	}
	cached, usable := []*entry(nil), false
	if fromCache {
		var err error
		if cached, usable, err = s.cachedFor(ctx, d.ID); err != nil {
			return out, err
		}
	}
	if usable {
		add(cached)
	} else {
		for _, n := range seasons {
			n := n
			found, failures, err := s.gather(ctx, sub, inSeason(scope, n, episodes))
			if err != nil {
				return out, err
			}
			out.Failures = append(out.Failures, failures...)
			add(found)
		}
	}

	plans, err := s.decide(ctx, in)
	if err != nil {
		return out, err
	}
	var errs []error
	for _, plan := range plans {
		e := entries[entryKey(plan.Candidate)]
		ids, _ := coveredBy(e.cand.Parsed, episodes, plan.Slot)
		ids = onlyPlanned(ids, plan.Covers, episodes)
		g, err := s.send(ctx, outgoing{
			titleID: d.ID, versionID: versionOf[plan.Slot], e: e, slot: plan.Slot, media: downloads.Series,
			episodes: ids, upgrade: plan.Upgrade,
		})
		if err != nil {
			errs = append(errs, err)
			continue
		}
		out.Grabbed = append(out.Grabbed, g)
	}
	errs = append(errs, s.noteOffers(ctx, d, versionOf, in, entries, episodes))
	return out, errors.Join(errs...)
}

// onlyPlanned keeps, of the episodes a Release holds, those Decide planned it for.
func onlyPlanned(ids []int64, covers []EpisodeRef, eps []library.Episode) []int64 {
	var out []int64
	for _, ep := range eps {
		if slices.Contains(ids, ep.ID) && slices.Contains(covers, EpisodeRef{ep.Season, ep.Number}) {
			out = append(out, ep.ID)
		}
	}
	return out
}
