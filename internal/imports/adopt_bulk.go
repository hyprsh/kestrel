package imports

import (
	"context"
	"errors"
	"fmt"
	"slices"

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
	// BulkOutcome: the row changed, was left as it was, or could not be done.
	BulkOutcome string
	// BulkReason says why a row was skipped.
	BulkReason string
)

const (
	OutcomeChanged BulkOutcome = "changed"
	OutcomeSkipped BulkOutcome = "skipped"
	OutcomeFailed  BulkOutcome = "failed"

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

// RowOutcome is one row's result.
type RowOutcome struct {
	RowID   int64
	Outcome BulkOutcome
	Reason  BulkReason
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
	Items    []RowOutcome
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
	var targets []int // indexes into rows, in the order the call names them
	var res BulkResult
	if len(req.RowIDs) > 0 {
		seen := map[int64]bool{}
		for _, id := range req.RowIDs {
			if seen[id] {
				continue
			}
			seen[id] = true
			if i := slices.IndexFunc(rows, func(r Row) bool { return r.ID == id }); i >= 0 {
				targets = append(targets, i)
			} else {
				res.Items = append(res.Items, RowOutcome{RowID: id, Outcome: OutcomeSkipped, Reason: ReasonNoSuchRow})
			}
		}
	} else {
		for _, r := range grouped(rows) {
			if req.Filter.keeps(r) {
				targets = append(targets, slices.IndexFunc(rows, func(o Row) bool { return o.ID == r.ID }))
			}
		}
	}

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
		var out RowOutcome
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
		changed = changed || out.Outcome == OutcomeChanged
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

func tickRow(row *Row, ticked bool) RowOutcome {
	out := RowOutcome{RowID: row.ID, Outcome: OutcomeSkipped, Status: row.Status}
	switch {
	case row.Status != Matched:
		out.Reason = ReasonNotMatched
	case row.Ticked == ticked:
		out.Reason = ReasonAlready
	default:
		row.Ticked = ticked
		out.Outcome = OutcomeChanged
	}
	return out
}

func monitorRow(row *Row, m library.Monitor) RowOutcome {
	out := RowOutcome{RowID: row.ID, Outcome: OutcomeSkipped, Status: row.Status}
	switch {
	case row.Match != nil && row.Match.TitleID != 0:
		out.Reason = ReasonTracked
	case row.Monitor == m:
		out.Reason = ReasonAlready
	default:
		row.Monitor = m
		out.Outcome = OutcomeChanged
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
func (a *Adoption) acceptSuggested(ctx context.Context, getEnv func() (*env, error), row *Row) RowOutcome {
	out := RowOutcome{RowID: row.ID, Outcome: OutcomeSkipped, Status: row.Status}
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
		out.Outcome, out.Message = OutcomeFailed, err.Error()
		return out
	}
	planned := *row
	switch err := a.replan(ctx, e, &planned, s.TMDBID); {
	case errors.Is(err, ErrNotSettleable):
		out.Reason = ReasonNotSettleable
	case err != nil:
		out.Outcome, out.Message = OutcomeFailed, err.Error()
	default:
		*row = planned
		out.Outcome, out.Status, out.SkipReason = OutcomeChanged, row.Status, row.SkipReason
	}
	return out
}
