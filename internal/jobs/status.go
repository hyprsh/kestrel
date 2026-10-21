package jobs

import (
	"sync"
	"time"

	"github.com/hyprsh/kestrel/internal/library"
)

// SearchStatus is the search pipeline as the Search loop sees it, from memory
// (ADR 0007): what waits for a search, how far the pass running now has got and
// how the last one went.
type SearchStatus struct {
	// Due is what waits for a search: what the last pass found due, less what
	// it has searched since. Between passes a recount every dueRecount brings
	// in the Versions that came due since ("Search all Wanted" kicks a pass at once).
	Due SearchDue
	// Pass is the pass running now; nil between passes.
	Pass *SearchPass
	// Last is the last pass that finished; nil before the first.
	Last *SearchPassResult
	// Next is when the next pass starts; zero while one runs and before the
	// loops start. A kick ("Search all Wanted", a new Version) starts one sooner.
	Next time.Time
}

// SearchDue counts what waits for a search.
type SearchDue struct {
	// Versions are the Wanted Versions due a missing search, and Episodes the
	// Wanted episodes of the Series Versions among them.
	Versions, Episodes int
	// Upgrades are the Filled Versions due an Upgrade search.
	Upgrades int
}

// SearchPass is the progress of the pass running now through the Wanted
// Versions it found due; its Upgrade searches come after them and are not counted.
type SearchPass struct {
	StartedAt time.Time
	// Done are the Versions it has got through, searched or passed over because
	// no indexer could take a sweep search, of Total.
	Done, Total int
}

// SearchPassResult is how a finished pass went.
type SearchPassResult struct {
	FinishedAt time.Time
	// Searched are the Wanted Versions it searched and Grabbed the Grabs it made.
	Searched, Grabbed int
}

// searchTracker keeps the SearchStatus while searchDue runs.
type searchTracker struct {
	mu sync.Mutex
	st SearchStatus
	// missing and upgrades are what the last pass found due and has not
	// searched yet, by Version; missing holds each one's Wanted episodes.
	missing, upgrades map[int64]int
	// cur is the running pass's result so far; it becomes st.Last at its end.
	cur SearchPassResult
}

// begin starts a pass at `at` over the Versions due a missing search.
func (t *searchTracker) begin(at time.Time, missing []library.Due) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.missing = map[int64]int{}
	for _, d := range missing {
		t.missing[d.VersionID] = d.Episodes
	}
	t.st.Pass = &SearchPass{StartedAt: at, Total: len(missing)}
	t.cur = SearchPassResult{}
	t.count()
}

// recount replaces what is due with a fresh count, between passes only: a
// pass keeps its own as it goes.
func (t *searchTracker) recount(missing, upgrades []library.Due) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.st.Pass != nil {
		return
	}
	t.missing, t.upgrades = map[int64]int{}, map[int64]int{}
	for _, d := range missing {
		t.missing[d.VersionID] = d.Episodes
	}
	for _, d := range upgrades {
		t.upgrades[d.VersionID] = 0
	}
	t.count()
}

// upgradesDue records the Versions due an Upgrade search now.
func (t *searchTracker) upgradesDue(upgrades []library.Due) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.upgrades = map[int64]int{}
	for _, d := range upgrades {
		t.upgrades[d.VersionID] = 0
	}
	t.count()
}

// searched records one search's outcome: of the Versions it was asked for
// (tried), the ones it searched are no longer due.
func (t *searchTracker) searched(upgrade bool, tried, versions []int64, grabs int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	due := t.missing
	if upgrade {
		due = t.upgrades
	} else if t.st.Pass != nil {
		t.st.Pass.Done += len(tried)
	}
	for _, v := range versions {
		if _, ok := due[v]; ok {
			delete(due, v)
			if !upgrade {
				t.cur.Searched++
			}
		}
	}
	t.cur.Grabbed += grabs
	t.count()
}

func (t *searchTracker) count() {
	d := SearchDue{Versions: len(t.missing), Upgrades: len(t.upgrades)}
	for _, n := range t.missing {
		d.Episodes += n
	}
	t.st.Due = d
}

// end finishes the pass at `at`.
func (t *searchTracker) end(at time.Time) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.st.Pass = nil
	last := t.cur
	last.FinishedAt = at
	t.st.Last = &last
}

// Search reports the search pipeline now.
func (r *Runner) Search() SearchStatus {
	next := r.next(Search)
	t := r.search
	t.mu.Lock()
	defer t.mu.Unlock()
	out := t.st
	out.Next = next
	if out.Pass != nil {
		p := *out.Pass
		out.Pass = &p
	}
	if out.Last != nil {
		l := *out.Last
		out.Last = &l
	}
	return out
}
