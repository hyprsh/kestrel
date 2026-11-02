package acquire

import (
	"context"

	"github.com/hyprsh/kestrel/internal/indexers"
)

// group is the indexers one round of a search asks: those of one Indexer
// Priority, or every enabled indexer at once (ADR 0025).
type group struct {
	priority int
	all      bool
}

// everyIndexer is the group of a manual search, and of an automatic one while
// the indexers share one priority.
var everyIndexer = group{all: true}

// groupsOf are the groups an automatic search asks in turn: one per Indexer
// Priority, lowest first. While every enabled indexer has the same priority
// (or none is enabled) it is one group of every indexer, so the search asks
// exactly what a search of every indexer asks.
func (s *Service) groupsOf(ctx context.Context) []group {
	ps := s.idx.Priorities(ctx)
	if len(ps) <= 1 {
		return []group{everyIndexer}
	}
	out := make([]group, len(ps))
	for i, p := range ps {
		out[i] = group{priority: p}
	}
	return out
}

// search asks the indexers of g.
func (s *Service) search(ctx context.Context, g group, q indexers.Query) indexers.Result {
	if g.all {
		return s.idx.Search(ctx, q)
	}
	return s.idx.SearchGroup(ctx, q, g.priority)
}

// holds says whether e came from an indexer of g.
func (g group) holds(e *entry) bool { return g.all || e.raw.IndexerPriority == g.priority }

// leftover is what plans leave of the Versions' units for the next group to be
// asked for: the listed units no plan covers, whether nothing was found for
// them, nothing beat the file held, or the only find was an Original Offer.
// Unlisted units are not carried over: the next group's Releases name their
// own. A Version with nothing left is dropped.
func leftover(vs []Version, plans []GrabPlan) []Version {
	covered := map[Slot]map[EpisodeRef]bool{}
	for _, p := range plans {
		if covered[p.Slot] == nil {
			covered[p.Slot] = map[EpisodeRef]bool{}
		}
		for _, r := range p.Covers {
			covered[p.Slot][r] = true
		}
	}
	var out []Version
	for _, v := range vs {
		left := Version{Slot: v.Slot}
		for _, u := range v.Units {
			if !u.Unlisted && !covered[v.Slot][u.Ref] {
				left.Units = append(left.Units, u)
			}
		}
		if len(left.Units) > 0 {
			out = append(out, left)
		}
	}
	return out
}
