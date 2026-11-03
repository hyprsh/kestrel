package acquire

import (
	"context"
	"errors"
	"maps"
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

// gatherSeries is gather for a Series: it asks the group's indexers by TheTVDB id
// (then by title), keeps the Releases that name this Series (and the scoped
// season or episodes) and scores each under every Version's Profile.
func (s *Service) gatherSeries(ctx context.Context, sub subject, scope library.Scope, g group) ([]*entry, []indexers.Failure, error) {
	d := sub.detail
	now := s.clock()
	episodes, err := s.lib.Episodes(ctx, d.ID, library.View{Now: now})
	if err != nil {
		return nil, nil, err
	}
	season, episode := scopeQuery(scope, episodes)
	res := s.search(ctx, g, indexers.Query{
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
	check := newShowCheck(d, episodes, now)

	var out []*entry
	for _, r := range res.Releases {
		parsed, err := release.Parse(r.Title, release.KindSeries)
		if err != nil {
			continue // not a name that can be read
		}
		if !r.ByID && !slices.ContainsFunc(parsedTitles(parsed), func(t string) bool { return names[normalize(t)] }) {
			continue // a text hit for some other Series
		}
		orig := parsed
		parsed, ok := resolveDaily(parsed, episodes)
		if !ok || !scopeWants(scope, parsed, episodes) {
			continue
		}
		title := scoring.Title{
			Name: d.Title, Year: d.Year, OriginalLanguage: release.LanguageByISO(d.OriginalLanguage),
			EpisodeTitles: episodeTitles(parsed, episodes), SeasonEpisodes: packEpisodes(parsed, episodes),
		}
		e, err := s.entryFor(ctx, sub, r, parsed, title, now)
		if err != nil {
			return nil, nil, err
		}
		e.reject(check.rejections(r, orig, parsed))
		out = append(out, e)
	}
	s.markFit(ctx, sub, res, out)
	s.cache.put(now, d.ID, g, out)
	return out, res.Failures, nil
}

// coveredBy are the episodes a Series Release holds that the library knows,
// and whether the Version in slot already has a file for any of them.
func coveredBy(p release.ParsedRelease, eps []library.Episode, slot Slot) (ids []int64, upgrade bool) {
	for _, ep := range episodesOf(p, eps) {
		ids = append(ids, ep.ID)
		if c := ep.Cells[slot]; c != nil && c.State == library.Filled {
			upgrade = true
		}
	}
	return ids, upgrade
}

// episodesOf are the episodes a Series Release holds that the library knows; nil for a Movie.
func episodesOf(p release.ParsedRelease, eps []library.Episode) []library.Episode {
	s := p.Series
	if s == nil {
		return nil
	}
	var out []library.Episode
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
		if in {
			out = append(out, ep)
		}
	}
	return out
}

// coversOf says what a Release covers for the Version in slot: each episode it holds that the library knows
// (the Movie itself for a Movie) with that Version's state for it and the Score of the file there.
func coversOf(d library.Detail, p release.ParsedRelease, eps []library.Episode, slot Slot) []Cover {
	stateOf := func(st library.State) CoverState {
		switch st {
		case library.Wanted:
			return CoverWanted
		case library.Filled:
			return CoverFilled
		}
		return CoverOther
	}
	if d.Kind != library.Series {
		for _, v := range d.Versions {
			if v.Slot != slot {
				continue
			}
			c := Cover{Whole: true, State: stateOf(v.State)}
			if v.File != nil {
				c.FileScore = v.File.Score
			}
			return []Cover{c}
		}
		return nil
	}
	var out []Cover
	for _, ep := range episodesOf(p, eps) {
		c := Cover{Season: ep.Season, Episode: ep.Number, State: CoverOther}
		if cell := ep.Cells[slot]; cell != nil {
			c.State, c.FileScore = stateOf(cell.State), cell.Score
		}
		out = append(out, c)
	}
	return out
}

// wantedIn counts the Units the Version in slot Wants within scope: its Wanted episodes, or 1 for a Wanted Movie.
func wantedIn(d library.Detail, eps []library.Episode, slot Slot, scope library.Scope) int {
	if d.Kind != library.Series {
		for _, v := range d.Versions {
			if v.Slot == slot && v.State == library.Wanted {
				return 1
			}
		}
		return 0
	}
	n := 0
	for _, ep := range eps {
		if scope.Season != nil && *scope.Season != ep.Season {
			continue
		}
		if len(scope.EpisodeIDs) > 0 && !slices.Contains(scope.EpisodeIDs, ep.ID) {
			continue
		}
		if c := ep.Cells[slot]; c != nil && c.State == library.Wanted {
			n++
		}
	}
	return n
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
// episodes within scope count. The indexers are asked by Indexer Priority
// (ADR 0025): each group only for the seasons of the episodes the earlier
// groups left with nothing to grab, and its Releases count only for those.
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
	searchedEpisodes := map[int64][]int64{}
	for _, v := range d.Versions {
		// An Upgrade search of named episodes (Search now's Upgrade) looks at those episodes' cells whatever the Version
		// as a whole is: a Version with a Wanted episode is Wanted, and its filled episodes can still be upgraded.
		if !slices.Contains(versionIDs, v.ID) || (v.State != want && !(upgrade && scope.Narrow())) {
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
				u.Held = cellHeld(cell, sub.versions[v.Slot])
				if u.Held.Done {
					continue // at its Profile's cutoff: no Upgrade is searched for
				}
			}
			ver.Units = append(ver.Units, u)
			searchedEpisodes[v.ID] = append(searchedEpisodes[v.ID], ep.ID)
		}
		out.Searched = append(out.Searched, v.ID)
		if len(ver.Units) > 0 {
			versionOf[v.Slot] = v.ID
			in.Versions = append(in.Versions, ver)
		}
	}
	out.scoped, out.episodes, out.library = scope.Narrow(), searchedEpisodes, episodes
	if len(in.Versions) == 0 {
		return out, nil
	}

	obs := ObserverOf(ctx)
	obs.Searching(targetOf(d, in, s.storedSlots(ctx)))
	out.asked = true
	entries := map[string]*entry{}
	var all []*entry
	var sent []GrabPlan
	var failed []failedSend
	var errs []error
	listed := episodes
	left := in.Versions
	paused, checked := false, false
	for _, g := range s.groupsOf(ctx) {
		round := Input{Versions: cloneVersions(left), SeasonsFinished: in.SeasonsFinished}
		add := func(found []*entry) {
			for _, e := range found {
				if _, seen := entries[entryKey(e.cand)]; !seen {
					entries[entryKey(e.cand)] = e
					all = append(all, e)
					in.Candidates = append(in.Candidates, e.cand)
					round.Candidates = append(round.Candidates, e.cand)
				}
			}
		}
		cached, usable := []*entry(nil), false
		if fromCache {
			var err error
			if cached, usable, err = s.cachedFor(ctx, d.ID, g); err != nil {
				return out, err
			}
		}
		if usable {
			add(cached)
			obs.Releases(len(cached))
		} else {
			failures, err := s.gatherSeasons(ctx, sub, scope, episodes, left, g, func(found []*entry) {
				obs.Releases(len(found))
				add(found)
			})
			out.Failures = append(out.Failures, failures...)
			if err != nil {
				return out, err
			}
		}
		if !upgrade {
			planUnlisted(&round, d, episodes, now, scope)
			round.Versions = dropPlanned(round.Versions, sent)
		}
		got := s.plan(round)
		if !checked {
			// Pause Grabs is checked once, before the first Grab. While it is on nothing is sent, and what
			// would be grabbed still counts as covered.
			var err error
			if paused, err = s.grabsPaused(ctx); err != nil {
				out.found(all)
				return out, err
			}
			checked = true
		}
		done := got
		if !paused {
			// Each round grabs what it plans, so a Grab that cannot be sent leaves its episodes to the next group.
			done = nil
			for _, group := range sharedPlans(got) {
				plan := group[0]
				e := entries[entryKey(plan.Candidate)]
				var ids, also []int64
				var placeholderErr error
				for i, p := range group {
					eps, err := s.placeholdersFor(ctx, d.ID, p.Covers, episodes)
					if err != nil {
						placeholderErr = err
						break
					}
					episodes = eps
					got, _ := coveredBy(e.cand.Parsed, episodes, p.Slot)
					for _, id := range onlyPlanned(got, p.Covers, episodes) {
						if !slices.Contains(ids, id) {
							ids = append(ids, id)
						}
					}
					if i > 0 {
						also = append(also, versionOf[p.Slot])
					}
				}
				if placeholderErr != nil {
					errs = append(errs, placeholderErr)
					continue
				}
				gr, err := s.send(ctx, outgoing{
					titleID: d.ID, versionID: versionOf[plan.Slot], also: also, e: e, copies: entryList(entries), slot: plan.Slot, media: downloads.Series,
					episodes: ids, upgrade: plan.Upgrade, by: GrabbedBySearch,
				})
				if errors.Is(err, errNotSent) {
					done = append(done, group...) // an active Grab already has it: not for the next group either
					continue
				}
				if err != nil {
					for _, p := range group {
						failed = append(failed, failedSend{p, err})
					}
					continue
				}
				out.Grabbed = append(out.Grabbed, gr)
				done = append(done, group...)
			}
		}
		sent = append(sent, done...)
		if left = leftover(left, done); len(left) == 0 {
			break
		}
	}
	out.found(all)
	if !upgrade {
		planUnlisted(&in, d, listed, now, scope)
	}
	errs = append(errs, sendErrors(failed, sent)...)
	errs = append(errs, s.noteOffers(ctx, d, versionOf, in, entries, episodes))
	return out, errors.Join(errs...)
}

// gatherSeasons asks the group g for what the Versions in left are missing:
// once for the whole Series, then per season only for the seasons whose
// episodes that answer has no candidate for (an indexer that ignores the
// season answers the later ones from the first). A search narrowed to a season
// or episodes, or with one season left, asks that season alone. each hears the
// Releases of every request.
func (s *Service) gatherSeasons(ctx context.Context, sub subject, scope library.Scope, episodes []library.Episode, left []Version, g group, each func([]*entry)) ([]indexers.Failure, error) {
	seasons := seasonsOf(left, scope)
	var failures []indexers.Failure
	var whole []*entry
	if !scope.Narrow() && len(seasons) > 1 {
		found, f, err := s.gather(ctx, sub, library.Scope{}, g)
		if err != nil {
			return failures, err
		}
		failures = append(failures, f...)
		each(found)
		whole = found
	}
	for _, n := range seasons {
		if whole != nil && candidateFor(whole, left, n) {
			continue
		}
		found, f, err := s.gather(ctx, sub, inSeason(scope, n, episodes), g)
		if err != nil {
			return failures, err
		}
		failures = append(failures, f...)
		each(found)
	}
	return failures, nil
}

// candidateFor says whether some Release among es that a Version's Profile
// accepts holds an episode left to find in the season.
func candidateFor(es []*entry, left []Version, season int) bool {
	var refs []EpisodeRef
	for _, v := range left {
		for _, u := range v.Units {
			if u.Ref.Season == season {
				refs = append(refs, u.Ref)
			}
		}
	}
	return slices.ContainsFunc(es, func(e *entry) bool {
		sr := e.cand.Parsed.Series
		if sr == nil || !slices.ContainsFunc(slices.Collect(maps.Values(e.cand.Verdicts)), func(v scoring.Verdict) bool { return v.Accepted }) {
			return false
		}
		return slices.ContainsFunc(refs, func(r EpisodeRef) bool {
			switch {
			case sr.MultiSeason:
				return r.Season >= sr.Season
			case r.Season != sr.Season:
				return false
			}
			return sr.FullSeason || slices.Contains(sr.Episodes, r.Episode)
		})
	})
}

// seasonsOf are the seasons a search asks the indexers for: those of the
// Versions' units, in order, Specials only when the scope names them.
func seasonsOf(vs []Version, scope library.Scope) []int {
	var out []int
	for _, v := range vs {
		for _, u := range v.Units {
			if (u.Ref.Season != 0 || scope.Narrow()) && !slices.Contains(out, u.Ref.Season) {
				out = append(out, u.Ref.Season)
			}
		}
	}
	slices.Sort(out)
	return out
}

// cloneVersions copies the Versions and their units, for an Input to add units to.
func cloneVersions(vs []Version) []Version {
	out := make([]Version, len(vs))
	for i, v := range vs {
		out[i] = Version{Slot: v.Slot, Units: slices.Clone(v.Units)}
	}
	return out
}

// dropPlanned takes out of the Versions, in place, the unlisted units an
// earlier group's plans already cover, so a later group does not plan them again.
func dropPlanned(vs []Version, plans []GrabPlan) []Version {
	for i, v := range vs {
		vs[i].Units = slices.DeleteFunc(v.Units, func(u Unit) bool {
			return u.Unlisted && slices.ContainsFunc(plans, func(p GrabPlan) bool {
				return p.Slot == v.Slot && slices.Contains(p.Covers, u.Ref)
			})
		})
	}
	return vs
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

// packEpisodes is how many episodes a season pack holds as far as the library knows them, for judging its size per
// episode; 0 for anything else.
func packEpisodes(p release.ParsedRelease, eps []library.Episode) int {
	if p.Series == nil || !p.Series.FullSeason || p.Series.MultiSeason {
		return 0
	}
	return len(episodesOf(p, eps))
}
