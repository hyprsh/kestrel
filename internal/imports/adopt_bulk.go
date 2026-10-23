package imports

import (
	"context"
	"errors"
	"fmt"

	"github.com/hyprsh/kestrel/internal/library"
)

// BulkAction is what a bulk edit does to each row it names. More actions can
// join these without changing the shape of BulkRequest or BulkResult.
type BulkAction string

const (
	// BulkTick includes rows in the commit.
	BulkTick BulkAction = "tick"
	// BulkUntick leaves rows out of the commit.
	BulkUntick BulkAction = "untick"
	// BulkAcceptSuggested settles Needs choice rows on Kestrel's confident suggestion.
	BulkAcceptSuggested BulkAction = "accept_suggested"
	// BulkSetMonitor gives rows their own choice of how the Title they add is monitored.
	BulkSetMonitor BulkAction = "set_monitor"
)

// BulkRequest names the rows of a bulk edit either one by one or as every row
// of a filter, resolved here, so "all N in this filter" is one call however
// many pages it spans.
type BulkRequest struct {
	Action BulkAction
	RowIDs []int64
	// Filter is used when RowIDs is empty.
	Filter Filter
	// Monitor is what BulkSetMonitor sets.
	Monitor library.Monitor
}

// What became of a row in a bulk edit.
type (
	// BulkEffect: the row changed, was left as it was, or could not be done.
	BulkEffect string
	// BulkReason says why a row was left.
	BulkReason string
)

const (
	BulkChanged BulkEffect = "changed"
	BulkLeft    BulkEffect = "left"
	BulkFailed  BulkEffect = "failed"

	ReasonAlready        BulkReason = "already"
	ReasonNoSuchRow      BulkReason = "no_such_row"
	ReasonNotMatched     BulkReason = "not_matched"
	ReasonNotNeedsChoice BulkReason = "not_needs_choice"
	ReasonNoSuggestion   BulkReason = "no_suggestion"
	ReasonNotConfident   BulkReason = "not_confident"
	ReasonNotSettleable  BulkReason = "not_settleable"
	// ReasonTracked: the row joins a Title Kestrel tracks, which keeps its monitoring.
	ReasonTracked BulkReason = "tracked"
)

// RowResult is what a bulk edit did to one row.
type RowResult struct {
	RowID  int64
	Result BulkEffect
	Reason BulkReason
	// Message says why a row failed.
	Message string
	// Status and SkipReason are the row's after a change.
	Status     RowStatus
	SkipReason string
}

// BulkResult is what a bulk edit did, one outcome per row in the order named.
type BulkResult struct {
	// Revision is the plan's revision afterwards: moved once if any row changed.
	Revision int64
	Items    []RowResult
}

// Bulk applies one action to many rows. Like PatchRow it holds the plan, and
// it settles the rows once and moves the revision once however many it edits.
func (a *Adoption) Bulk(ctx context.Context, req BulkRequest) (BulkResult, error) {
	switch req.Action {
	case BulkTick, BulkUntick, BulkAcceptSuggested:
	case BulkSetMonitor:
		if !req.Monitor.Valid() {
			return BulkResult{}, ErrBadMonitor
		}
	default:
		return BulkResult{}, fmt.Errorf("imports: unknown bulk action %q", req.Action)
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	recs, rows, err := a.editable(ctx)
	if err != nil {
		return BulkResult{}, err
	}
	targets, res := bulkTargets(rows, req)

	var e *env
	getEnv := func() (*env, error) { // read once, and only if an accept gets that far
		var err error
		if e == nil {
			e, err = a.env(ctx)
		}
		return e, err
	}
	changed := false
	for _, i := range targets {
		var out RowResult
		switch req.Action {
		case BulkTick, BulkUntick:
			out = tickRow(&rows[i], req.Action == BulkTick)
		case BulkAcceptSuggested:
			out = a.acceptSuggested(ctx, getEnv, &rows[i])
		case BulkSetMonitor:
			out = monitorRow(&rows[i], req.Monitor)
		}
		if ctx.Err() != nil {
			return BulkResult{}, ctx.Err()
		}
		changed = changed || out.Result == BulkChanged
		res.Items = append(res.Items, out)
	}
	if changed {
		if err := a.saveEdit(ctx, recs, rows); err != nil {
			return BulkResult{}, err
		}
	}
	plan, err := a.q.GetAdoptionPlan(ctx)
	if err != nil {
		return BulkResult{}, err
	}
	res.Revision = plan.Revision
	return res, nil
}

// bulkTargets are the indexes into rows of the rows a request names, in the
// order it names them or the order Rows lists them, and a left result for every
// id that names no row of the plan under review. The plan's rows are indexed
// once, so naming many rows costs no more than reading them.
func bulkTargets(rows []Row, req BulkRequest) ([]int, BulkResult) {
	var res BulkResult
	if len(req.RowIDs) == 0 {
		return filterTargets(rows, req.Filter), res
	}
	at := make(map[int64]int, len(rows))
	for i, r := range rows {
		at[r.ID] = i
	}
	var targets []int
	seen := map[int64]bool{}
	for _, id := range req.RowIDs {
		if seen[id] {
			continue
		}
		seen[id] = true
		if i, ok := at[id]; ok && rows[i].Outcome == "" { // a kept row is not under review
			targets = append(targets, i)
		} else {
			res.Items = append(res.Items, RowResult{RowID: id, Result: BulkLeft, Reason: ReasonNoSuchRow})
		}
	}
	return targets, res
}

// filterTargets are the indexes into rows of the rows of the plan under review
// the filter keeps, Matched first, then Needs choice, then Skipped.
func filterTargets(rows []Row, f Filter) []int {
	var out []int
	for _, status := range []RowStatus{Matched, NeedsChoice, Skipped} {
		for i, r := range rows {
			if r.Status == status && r.Outcome == "" && f.keeps(r) {
				out = append(out, i)
			}
		}
	}
	return out
}

func tickRow(row *Row, ticked bool) RowResult {
	out := RowResult{RowID: row.ID, Result: BulkLeft, Status: row.Status}
	switch {
	case row.Status != Matched:
		out.Reason = ReasonNotMatched
	case row.Ticked == ticked:
		out.Reason = ReasonAlready
	default:
		row.Ticked = ticked
		out.Result = BulkChanged
	}
	return out
}

func monitorRow(row *Row, m library.Monitor) RowResult {
	out := RowResult{RowID: row.ID, Result: BulkLeft, Status: row.Status}
	switch {
	case row.Match != nil && row.Match.TitleID != 0:
		out.Reason = ReasonTracked
	case row.Monitor == m:
		out.Reason = ReasonAlready
	default:
		row.Monitor = m
		out.Result = BulkChanged
	}
	return out
}

// suggestion is the candidate Kestrel would pick, nil when it has none.
func suggestion(r Row) *Candidate {
	for i := range r.Candidates {
		if r.Candidates[i].Suggested {
			return &r.Candidates[i]
		}
	}
	return nil
}

// acceptSuggested settles a Needs choice row on its confident suggestion, the
// way choosing that candidate by hand does.
func (a *Adoption) acceptSuggested(ctx context.Context, getEnv func() (*env, error), row *Row) RowResult {
	out := RowResult{RowID: row.ID, Result: BulkLeft, Status: row.Status}
	if row.Status != NeedsChoice {
		out.Reason = ReasonNotNeedsChoice
		return out
	}
	s := suggestion(*row)
	switch {
	case s == nil:
		out.Reason = ReasonNoSuggestion
		return out
	case !s.Confident:
		out.Reason = ReasonNotConfident
		return out
	}
	e, err := getEnv()
	if err != nil {
		out.Result, out.Message = BulkFailed, err.Error()
		return out
	}
	planned := *row
	switch err := a.replan(ctx, e, &planned, s.TMDBID); {
	case errors.Is(err, ErrNotSettleable):
		out.Reason = ReasonNotSettleable
	case err != nil:
		out.Result, out.Message = BulkFailed, err.Error()
	default:
		*row = planned
		out.Result, out.Status, out.SkipReason = BulkChanged, row.Status, row.SkipReason
	}
	return out
}
