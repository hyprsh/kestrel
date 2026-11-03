package acquire_test

import (
	"context"
	"sync"

	"github.com/hyprsh/kestrel/internal/plugin"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	ixfake "github.com/hyprsh/kestrel/internal/plugin/indexer/v1/fake"
)

// tap records the searches the first indexer answers and can make it behave like a real one: rank only some
// Releases first for a search without a season, or ignore the season altogether.
type tap struct {
	mu      sync.Mutex
	queries []indexer.SearchQuery
	// ranked, when set, keeps of a season-less search's answer only the Releases it returns true for.
	ranked func(indexer.Release) bool
	// ignoresSeason answers every search as if it named no season.
	ignoresSeason bool
}

// calls are the seasons the searches asked so far named, "" for the whole Series.
func (t *tap) calls() []string {
	t.mu.Lock()
	defer t.mu.Unlock()
	var out []string
	for _, q := range t.queries {
		out = append(out, q.Season)
	}
	return out
}

func (t *tap) count() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.queries)
}

type tapped struct {
	*ixfake.Indexer
	tap *tap
}

func (i tapped) Search(ctx context.Context, conn plugin.Connection, q indexer.SearchQuery) (indexer.SearchResult, error) {
	i.tap.mu.Lock()
	i.tap.queries = append(i.tap.queries, q)
	ranked, ignores := i.tap.ranked, i.tap.ignoresSeason
	i.tap.mu.Unlock()
	if ignores {
		q.Season, q.Episode = "", ""
	}
	res, err := i.Indexer.Search(ctx, conn, q)
	if err != nil || ranked == nil || q.Season != "" {
		return res, err
	}
	var keep []indexer.Release
	for _, r := range res.Releases {
		if ranked(r) {
			keep = append(keep, r)
		}
	}
	res.Releases, res.Total = keep, len(keep)
	return res, nil
}
