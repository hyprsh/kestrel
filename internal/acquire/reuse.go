package acquire

import (
	"context"
	"fmt"
	"maps"
	"slices"
	"sync"
	"time"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/scoring"
)

// ReuseWindow is how long an answer of the indexers may serve a later search of the same Title and scope: the sweep,
// the search on add, a bulk Search and Interactive search reuse it, Search now does not. Fixed, no setting.
const ReuseWindow = 30 * time.Minute

// asked is what a search asked the indexers of one group for: the whole Title, a season or episodes of it.
type asked struct {
	whole  bool
	season int
	// episodes are the episode ids of a search narrowed to some; empty for a whole season.
	episodes []int64
}

// askedOf is the scope a search is recorded and matched by. A scope without a season asks for the whole Title, as the
// indexers are asked: episode ids alone never narrow the query, and a Movie has no scope.
func askedOf(sc library.Scope) asked {
	if sc.Season == nil {
		return asked{whole: true}
	}
	a := asked{season: *sc.Season, episodes: slices.Clone(sc.EpisodeIDs)}
	slices.Sort(a.episodes)
	return a
}

// covers says whether an answer to a asks for everything b asks for: a wider answer may serve a narrower search, a
// narrower one never serves a wider one.
func (a asked) covers(b asked) bool {
	switch {
	case a.whole:
		return true
	case b.whole, a.season != b.season:
		return false
	case len(a.episodes) == 0:
		return true
	case len(b.episodes) == 0:
		return false
	}
	return !slices.ContainsFunc(b.episodes, func(id int64) bool { return !slices.Contains(a.episodes, id) })
}

// answer is a search of a group that every one of its indexers answered, and when.
type answer struct {
	asked asked
	at    time.Time
}

// answered records that the search of the group g for the Title answered, for reuse: a group that errored, timed out
// or was stopped by its budget is not recorded and is asked again by the next search.
func (c *cache) answered(now time.Time, titleID int64, g group, a asked) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for id, groups := range c.answers {
		for g, as := range groups {
			groups[g] = slices.DeleteFunc(as, func(x answer) bool { return now.Sub(x.at) >= ReuseWindow })
			if len(groups[g]) == 0 {
				delete(groups, g)
			}
		}
		if len(groups) == 0 {
			delete(c.answers, id)
		}
	}
	if c.answers[titleID] == nil {
		c.answers[titleID] = map[group][]answer{}
	}
	// The new answer replaces the older ones it covers.
	kept := slices.DeleteFunc(c.answers[titleID][g], func(x answer) bool { return a.covers(x.asked) })
	c.answers[titleID][g] = append(kept, answer{asked: a, at: now})
}

// answerFor is the oldest answer that, for each group of gs, covers a and is younger than ReuseWindow: a group's own
// or one of every indexer. ok is false when some group has none.
func (c *cache) answerFor(now time.Time, titleID int64, gs []group, a asked) (at time.Time, ok bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for i, g := range gs {
		var best time.Time
		for _, held := range []group{g, everyIndexer} {
			for _, x := range c.answers[titleID][held] {
				if now.Sub(x.at) < ReuseWindow && x.asked.covers(a) && x.at.After(best) {
					best = x.at
				}
			}
		}
		if best.IsZero() {
			return time.Time{}, false
		}
		if i == 0 || best.Before(at) {
			at = best
		}
	}
	return at, len(gs) > 0
}

// reuseKey carries a search's permission to answer from the cache, and records what it did.
type reuseKey struct{}

// reuse is the record of one search's reuse: how many of its requests an earlier answer served, how many asked the
// indexers, and the age of the oldest answer used.
type reuse struct {
	mu     sync.Mutex
	hits   int
	misses int
	oldest time.Time
	// listing is set for Interactive search, which lists a Blocklisted Release as rejected instead of leaving it out.
	listing bool
}

// withReuse lets the search under ctx answer from a recent answer of the indexers, and returns the record.
func withReuse(ctx context.Context) (context.Context, *reuse) {
	r := &reuse{}
	return context.WithValue(ctx, reuseKey{}, r), r
}

func reuseOf(ctx context.Context) *reuse {
	r, _ := ctx.Value(reuseKey{}).(*reuse)
	return r
}

func (r *reuse) hit(at time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.hits++
	if r.oldest.IsZero() || at.Before(r.oldest) {
		r.oldest = at
	}
}

func (r *reuse) miss() {
	r.mu.Lock()
	r.misses++
	r.mu.Unlock()
}

// note is the sentence the Searched event adds to its reason: empty when the indexers answered every request.
func (r *reuse) note(now time.Time) string {
	if r == nil {
		return ""
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	switch {
	case r.hits == 0:
		return ""
	case r.misses == 0:
		return "answered from a search " + ago(now.Sub(r.oldest))
	}
	return "part answered from a search " + ago(now.Sub(r.oldest)) + ", the rest asked of the indexers"
}

// ago says how long ago in minutes, "4 min ago", and "under a minute ago" below one.
func ago(d time.Duration) string {
	if m := int(d / time.Minute); m > 0 {
		return fmt.Sprintf("%d min ago", m)
	}
	return "under a minute ago"
}

// reused answers a request of gather from the cache when ctx allows it and the group (every group, for a search of
// every indexer) has an answer for the Title that covers the scope. The Releases are those of the Title in the cache
// that the scope takes in, Blocklist applied now. It reports false when the indexers have to be asked.
func (s *Service) reused(ctx context.Context, sub subject, scope library.Scope, g group) ([]*entry, bool, error) {
	r := reuseOf(ctx)
	if r == nil {
		return nil, false, nil
	}
	now := s.clock()
	if sub.detail.Kind != library.Series || scope.Season == nil {
		scope = library.Scope{} // a Movie has no scope; episode ids alone ask for the whole Series
	}
	gs := []group{g}
	if g.all {
		gs = s.groupsOf(ctx)
	}
	at, ok := s.cache.answerFor(now, sub.detail.ID, gs, askedOf(scope))
	if !ok {
		r.miss()
		return nil, false, nil
	}
	var eps []library.Episode
	if sub.detail.Kind == library.Series {
		var err error
		if eps, err = s.lib.Episodes(ctx, sub.detail.ID, library.View{Now: now}); err != nil {
			return nil, false, err
		}
	}
	c := s.cache
	newest := map[string]*entry{}
	c.mu.Lock()
	for _, e := range c.m {
		if e.titleID != sub.detail.ID || now.Sub(e.at) >= ReuseWindow || !g.holds(e) || !scopeWants(scope, e.cand.Parsed, eps) {
			continue
		}
		if k := entryKey(e.cand); newest[k] == nil || e.at.After(newest[k].at) {
			newest[k] = e
		}
	}
	c.mu.Unlock()
	out := make([]*entry, 0, len(newest))
	for _, e := range newest {
		// A Version added since the answer has no Verdict on its Releases: ask again.
		for slot := range sub.versions {
			if _, ok := e.cand.Verdicts[slot]; !ok {
				r.miss()
				return nil, false, nil
			}
		}
		blocked, err := s.blocklisted(ctx, e.raw)
		if err != nil {
			return nil, false, err
		}
		switch {
		case !blocked:
			out = append(out, e)
		case r.listing:
			// Same id, so the list still names the cached Release; the Verdicts are a copy that now rejects it.
			cp := *e
			cp.cand.Verdicts = maps.Clone(e.cand.Verdicts)
			if !slices.Contains(cp.cand.Verdicts[firstSlot(sub)].Rejections, scoring.RejectBlocklisted) {
				cp.reject([]scoring.Rejection{scoring.RejectBlocklisted})
			}
			out = append(out, &cp)
		}
	}
	slices.SortFunc(out, func(a, b *entry) int {
		if c := a.at.Compare(b.at); c != 0 {
			return c
		}
		return cmpString(a.id, b.id)
	})
	r.hit(at)
	return out, true, nil
}

// firstSlot is some Slot of the subject's Versions, to read a Release's Verdict by.
func firstSlot(sub subject) Slot {
	for slot := range sub.versions {
		return slot
	}
	return ""
}
