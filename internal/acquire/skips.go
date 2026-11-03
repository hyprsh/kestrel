package acquire

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"sync"

	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/library"
)

// A search that was due but did not run (or ran and could send nothing) says so in the Log, with why. A sweep pass
// would otherwise write a row per Title, so the pass carries a Skips in its context (WithSkips) and writes one entry
// per reason when it ends (FlushSkips), with the count and the Titles named. A search outside a pass has no Skips
// and writes its entry at once.

// SkipReason is why a due search did not run.
type SkipReason string

const (
	// SkipBudget: every indexer had used 80 % of its daily search budget, so the sweep left the search for later.
	SkipBudget SkipReason = "budget"
	// SkipPaused: every indexer was paused or backing off.
	SkipPaused SkipReason = "paused"
	// SkipActiveGrab: an active Grab already covers what the search would have looked for.
	SkipActiveGrab SkipReason = "active_grab"
	// SkipPauseGrabs: Pause Grabs is on; the search ran and scored Releases but sent none.
	SkipPauseGrabs SkipReason = "pause_grabs"
)

// text is the wording of the reason and of the first words of the message.
func (r SkipReason) text() (reason, what string) {
	switch r {
	case SkipBudget:
		return "budget: every indexer has used 80 % of its daily search budget, so the sweep left these for later", "did not run"
	case SkipPaused:
		return "paused: every indexer is paused or backing off, so the sweep left these for later", "did not run"
	case SkipActiveGrab:
		return "skipped: an active Grab covers it", "did not run"
	}
	return "Pause Grabs is on: the search ran and scored Releases but sent none", "sent nothing"
}

type skipGroup struct {
	count   int
	titles  []int64
	names   map[int64]string
	indexes []string
}

// Skips collects the searches a sweep pass skipped, by reason.
type Skips struct {
	mu   sync.Mutex
	hist *history.Service
	by   map[SkipReason]*skipGroup
	rank []SkipReason
}

type skipsKey struct{}

// WithSkips returns a context carrying a new Skips and the Skips; the pass calls FlushSkips when it ends.
func WithSkips(ctx context.Context) (context.Context, *Skips) {
	sk := &Skips{by: map[SkipReason]*skipGroup{}}
	return context.WithValue(ctx, skipsKey{}, sk), sk
}

// add counts n skipped searches of a Title.
func (sk *Skips) add(h *history.Service, reason SkipReason, titleID int64, name string, n int, indexers []string) {
	sk.mu.Lock()
	defer sk.mu.Unlock()
	sk.hist = h
	g := sk.by[reason]
	if g == nil {
		g = &skipGroup{names: map[int64]string{}}
		sk.by[reason] = g
		sk.rank = append(sk.rank, reason)
	}
	g.count += n
	if !slices.Contains(g.titles, titleID) {
		g.titles = append(g.titles, titleID)
		g.names[titleID] = name
	}
	for _, ix := range indexers {
		if !slices.Contains(g.indexes, ix) {
			g.indexes = append(g.indexes, ix)
		}
	}
}

// namedTitles is how many Titles an entry names in its message; Data carries all of them.
const namedTitles = 5

// FlushSkips writes the entry of each reason the pass collected, in the order they first came up, and empties sk.
// The trigger is ctx's (the sweep).
func FlushSkips(ctx context.Context, sk *Skips) {
	if sk == nil {
		return
	}
	sk.mu.Lock()
	by, rank, h := sk.by, sk.rank, sk.hist
	sk.by, sk.rank = map[SkipReason]*skipGroup{}, nil
	sk.mu.Unlock()
	for _, r := range rank {
		recordSkip(ctx, h, r, by[r])
	}
}

func recordSkip(ctx context.Context, h *history.Service, reason SkipReason, g *skipGroup) {
	why, what := reason.text()
	var names []string
	type titleRef struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	}
	var refs []titleRef
	for _, id := range g.titles {
		refs = append(refs, titleRef{id, g.names[id]})
		names = append(names, g.names[id])
	}
	list := strings.Join(names[:min(len(names), namedTitles)], ", ")
	if more := len(names) - namedTitles; more > 0 {
		list += fmt.Sprintf(" and %d more", more)
	}
	noun := "searches"
	if g.count == 1 {
		noun = "search"
	}
	data, _ := json.Marshal(map[string]any{"why": string(reason), "count": g.count, "titles": refs, "indexers": g.indexes})
	h.Record(context.WithoutCancel(ctx), history.Event{
		Kind: history.SearchSkipped, Data: data,
		Message: fmt.Sprintf("%d due %s %s: %s", g.count, noun, what, list),
		Trigger: history.TriggerOr(ctx, sweepTrigger), Reason: why,
	})
}

// sweepBlocker is what an indexers host can add to CanSweep: which indexers stopped the sweep and why. A host
// without it is reported as paused.
type sweepBlocker interface {
	SweepBlock(ctx context.Context) (budget bool, names []string)
}

// noteSkipped says that count due searches of the Title did not run for the reason. It never fails the search.
func (s *Service) noteSkipped(ctx context.Context, reason SkipReason, titleID int64, count int, indexers []string) {
	if s.hist == nil || count <= 0 {
		return
	}
	name := fmt.Sprintf("Title %d", titleID)
	if d, err := s.lib.Get(ctx, titleID, library.View{Now: s.clock()}); err == nil && d.Title != "" {
		name = d.Title
	}
	if sk, _ := ctx.Value(skipsKey{}).(*Skips); sk != nil {
		sk.add(s.hist, reason, titleID, name, count, indexers)
		return
	}
	g := &skipGroup{count: count, titles: []int64{titleID}, names: map[int64]string{titleID: name}, indexes: indexers}
	recordSkip(ctx, s.hist, reason, g)
}

// noteSweepBlocked records the searches a sweep left because no indexer could be asked.
func (s *Service) noteSweepBlocked(ctx context.Context, titleID int64, versionIDs []int64) {
	reason, names := SkipPaused, []string(nil)
	if b, ok := s.idx.(sweepBlocker); ok {
		var budget bool
		if budget, names = b.SweepBlock(ctx); budget {
			reason = SkipBudget
		}
	}
	s.noteSkipped(ctx, reason, titleID, len(versionIDs), names)
}
