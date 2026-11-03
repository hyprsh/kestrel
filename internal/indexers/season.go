package indexers

import (
	"fmt"
	"hash/fnv"
	"slices"
	"time"

	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
)

// Indexers that ignore the season (#386). Some indexers answer an ID search
// with the same Releases whatever season it names. The host notices when two
// season searches of one Series come back identical and from then on asks
// that indexer once for the whole Series, whatever the season, and serves the
// season searches that follow from that answer for memoTTL. The caller
// filters the Releases to its season, as it does for every indexer.
const (
	// minIdentical is how many Releases two answers must share to be told identical: a
	// lone multi-season pack can be the whole answer to two seasons.
	minIdentical = 3
	// memoTTL is how long a whole-Series answer serves the season searches of an indexer that ignores the season.
	memoTTL = 5 * time.Minute
	// maxProbes bounds the Series an indexer's last season answers are kept for.
	maxProbes = 64
)

type seasonProbe struct {
	season string
	print  uint64
}

type memoed struct {
	at       time.Time
	releases []indexer.Release
}

// seasonMemory is what the host has learned of whether an indexer heeds the season.
type seasonMemory struct {
	ignores bool
	probes  map[string]seasonProbe // by Series, the latest season answer
	memo    map[string]memoed      // by query, a whole-Series answer
}

func seriesKey(q indexer.SearchQuery) string {
	return fmt.Sprint(q.IMDBID, "/", q.TMDBID, "/", q.TVDBID, "/", q.Text)
}

func queryKey(q indexer.SearchQuery) string {
	return fmt.Sprint(q.Mode, "/", seriesKey(q), "/", q.Season, "/", q.Episode, "/", q.Categories)
}

// printOf identifies the set of Releases an answer holds.
func printOf(rels []indexer.Release) uint64 {
	ids := make([]string, len(rels))
	for i, r := range rels {
		ids[i] = r.GUID
	}
	slices.Sort(ids)
	h := fnv.New64a()
	for _, id := range ids {
		h.Write([]byte(id))
		h.Write([]byte{0})
	}
	return h.Sum64()
}

// IgnoresSeason says whether the host has seen the indexer return the same
// Releases for different seasons of one Series.
func (s *Service) IgnoresSeason(indexerID int64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.states[indexerID]
	return st != nil && st.seasons.ignores
}

// withoutSeason is q for an indexer that ignores the season: the whole-Series
// search, which the Releases of every season are filtered from. ok is false
// when q is not a Series search that names a season or the host has not seen
// the indexer ignore it.
func (s *Service) withoutSeason(inst instances.Instance, q Query) (Query, bool) {
	if q.Media != indexer.MediaTV || q.Season == "" {
		return q, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.stateOf(inst).seasons.ignores {
		return q, false
	}
	q.Season, q.Episode = "", ""
	return q, true
}

// memoFor returns the whole-Series answer an indexer that ignores the season gave a moment ago, if any.
func (s *Service) memoFor(inst instances.Instance, q indexer.SearchQuery) ([]indexer.Release, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, ok := s.stateOf(inst).seasons.memo[queryKey(q)]
	if !ok || s.clock().Sub(m.at) >= memoTTL {
		return nil, false
	}
	return slices.Clone(m.releases), true
}

// remember keeps a whole-Series answer of an indexer that ignores the season.
func (s *Service) remember(inst instances.Instance, q indexer.SearchQuery, rels []indexer.Release) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.clock()
	sm := &s.stateOf(inst).seasons
	if sm.memo == nil {
		sm.memo = map[string]memoed{}
	}
	for k, m := range sm.memo {
		if now.Sub(m.at) >= memoTTL {
			delete(sm.memo, k)
		}
	}
	sm.memo[queryKey(q)] = memoed{at: now, releases: slices.Clone(rels)}
}

// noteSeasonAnswer compares a season search's answer with the one before it for
// the same Series, and remembers the indexer ignores the season when they are
// the same Releases for two different seasons.
func (s *Service) noteSeasonAnswer(inst instances.Instance, q indexer.SearchQuery, rels []indexer.Release) {
	if q.Media != indexer.MediaTV || q.Mode != indexer.ModeIDs || q.Season == "" || q.Episode != "" || len(rels) < minIdentical {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	sm := &s.stateOf(inst).seasons
	if sm.ignores {
		return
	}
	key, print := seriesKey(q), printOf(rels)
	if p, ok := sm.probes[key]; ok && p.season != q.Season && p.print == print {
		sm.ignores = true
		sm.probes = nil
		s.log.Info("indexers: the indexer returns the same Releases for different seasons; asking it once for the whole Series", "indexer", inst.Name)
		return
	}
	if sm.probes == nil || len(sm.probes) >= maxProbes {
		sm.probes = map[string]seasonProbe{}
	}
	sm.probes[key] = seasonProbe{q.Season, print}
}
