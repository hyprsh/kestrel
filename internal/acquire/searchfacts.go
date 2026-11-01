package acquire

import (
	"context"
	"encoding/json"
	"slices"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire/db"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/scoring"
)

// SearchEnd is how a search of a Version ended.
type SearchEnd string

const (
	// SearchGrabbed: it grabbed a Release for the Version.
	SearchGrabbed SearchEnd = "grabbed"
	// SearchNothingFit: the indexers answered and no Release was fit to grab (none came back, none fit the Profile,
	// or none beat what the Version holds).
	SearchNothingFit SearchEnd = "nothing_fit"
	// SearchNoIndexer: no indexer is enabled, so nothing was asked.
	SearchNoIndexer SearchEnd = "no_indexer"
	// SearchError: the search failed, or every indexer failed to answer.
	SearchError SearchEnd = "error"
)

// ReasonCount is how many of the Releases a search returned one rejection code applied to.
type ReasonCount struct {
	Code  scoring.Rejection `json:"code"`
	Count int               `json:"count"`
}

// LastSearch is what the last search of a Version found. Only searches that asked the indexers leave one: a
// Version that was not due, or whose Grab is still running, is not searched.
type LastSearch struct {
	VersionID int64
	At        time.Time
	// Releases is how many Releases the indexers returned for the Title.
	Releases int
	Outcome  SearchEnd
	// Reasons counts the Version's rejections of those Releases, the most common first.
	Reasons []ReasonCount
	// Upgrade is true for an Upgrade search, which looks for better than the file the Version holds.
	Upgrade bool
}

// LastSearches returns the last search of each of the Versions that was ever searched.
func (s *Service) LastSearches(ctx context.Context, versionIDs []int64) (map[int64]LastSearch, error) {
	out := map[int64]LastSearch{}
	if len(versionIDs) == 0 {
		return out, nil
	}
	ids, _ := json.Marshal(versionIDs)
	rows, err := db.New(s.st.Read()).ListVersionSearches(ctx, string(ids))
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		ls := LastSearch{VersionID: r.VersionID, At: parseTime(r.At), Releases: int(r.Releases), Outcome: SearchEnd(r.Outcome), Upgrade: r.Upgrade == 1}
		_ = json.Unmarshal([]byte(r.Reasons), &ls.Reasons)
		out[r.VersionID] = ls
	}
	return out, nil
}

// found keeps what a search saw, for noteSearched.
func (o *Outcome) found(entries []*entry) {
	o.Releases = len(entries)
	o.entries = entries
}

// noteSearched records, for each Version a search asked the indexers for, what it found. A search cut short by
// shutdown is not recorded.
func (s *Service) noteSearched(ctx context.Context, titleID int64, upgrade bool, out Outcome, err error) {
	if len(out.Searched) == 0 || ctx.Err() != nil {
		return
	}
	d, derr := s.lib.Get(ctx, titleID, library.View{Now: s.clock()})
	if derr != nil {
		return
	}
	slots := map[int64]Slot{}
	for _, v := range d.Versions {
		slots[v.ID] = v.Slot
	}
	q := db.New(s.st.Write())
	now := ts(s.clock())
	for _, vid := range out.Searched {
		slot, ok := slots[vid]
		if !ok {
			continue
		}
		reasons, _ := json.Marshal(reasonCounts(out.entries, slot))
		_ = q.UpsertVersionSearch(ctx, db.UpsertVersionSearchParams{
			VersionID: vid, At: now, Releases: int64(out.Releases), Outcome: string(s.endOf(ctx, out, vid, err)),
			Reasons: string(reasons), Upgrade: b2i(upgrade),
		})
	}
}

// endOf says how the search of one Version ended: grabbed when a Grab was made for it, else an error when the search
// failed or no indexer could answer, else nothing fit.
func (s *Service) endOf(ctx context.Context, out Outcome, versionID int64, err error) SearchEnd {
	for _, g := range out.Grabbed {
		if g.VersionID == versionID {
			return SearchGrabbed
		}
	}
	switch {
	case err != nil:
		return SearchError
	case s.idx.Enabled(ctx) == 0:
		return SearchNoIndexer
	case len(out.Failures) > 0 && out.Releases == 0:
		return SearchError
	}
	return SearchNothingFit
}

// reasonCounts counts, per rejection code, the Releases the Version in slot rejects; the most common come first.
func reasonCounts(entries []*entry, slot Slot) []ReasonCount {
	counts := map[scoring.Rejection]int{}
	for _, e := range entries {
		for _, code := range reasonsFor(e, slot) {
			counts[code]++
		}
	}
	out := make([]ReasonCount, 0, len(counts))
	for code, n := range counts {
		out = append(out, ReasonCount{Code: code, Count: n})
	}
	slices.SortFunc(out, func(a, b ReasonCount) int {
		if a.Count != b.Count {
			return b.Count - a.Count
		}
		return cmpString(string(a.Code), string(b.Code))
	})
	return out
}

func cmpString(a, b string) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	}
	return 0
}
