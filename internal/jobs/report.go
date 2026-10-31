package jobs

import (
	"context"
	"time"
)

// Progress is how far the pass running now has got, in whatever unit its loop
// counts (the trash loop counts Titles re-scored).
type Progress struct {
	Done, Total int
}

// OutcomeKind says how a pass that reports an outcome ended.
type OutcomeKind string

// The outcomes the trash loop reports.
const (
	// OutcomeUpdated: a newer TRaSH snapshot is active.
	OutcomeUpdated OutcomeKind = "updated"
	// OutcomeUpToDate: TRaSH had nothing newer.
	OutcomeUpToDate OutcomeKind = "up_to_date"
	// OutcomeRejected: the snapshot was refused whole and the previous one stays.
	OutcomeRejected OutcomeKind = "rejected"
	// OutcomeUnreachable: TRaSH could not be asked.
	OutcomeUnreachable OutcomeKind = "unreachable"
	// OutcomeRescored: the files were re-scored after a Primary Language change.
	OutcomeRescored OutcomeKind = "rescored"
	// OutcomeFailed: the pass failed for another reason (Text says why).
	OutcomeFailed OutcomeKind = "failed"
)

// Outcome is what a pass said about how it went, in words the UI can show. A
// loop keeps its last one until a pass reports another, so a pass with nothing
// to say (the daily check that is not due) does not wipe it.
type Outcome struct {
	Kind OutcomeKind
	Text string
	// At is when the pass reported it; the UI tells a new outcome by it.
	At time.Time
}

type reporterKey struct{}

// reporter lets a pass tell the runner about itself while it runs.
type reporter struct {
	r *Runner
	l *loop
}

func withReporter(ctx context.Context, r *Runner, l *loop) context.Context {
	return context.WithValue(ctx, reporterKey{}, &reporter{r, l})
}

// ReportProgress says how far the pass running under ctx has got. Outside a
// pass it does nothing, so work shared with other callers can always call it.
func ReportProgress(ctx context.Context, done, total int) {
	rep, _ := ctx.Value(reporterKey{}).(*reporter)
	if rep == nil {
		return
	}
	rep.r.mu.Lock()
	defer rep.r.mu.Unlock()
	rep.l.state.progress = &Progress{Done: done, Total: total}
}

// ReportOutcome says how the pass running under ctx went. Outside a pass it
// does nothing.
func ReportOutcome(ctx context.Context, kind OutcomeKind, text string) {
	rep, _ := ctx.Value(reporterKey{}).(*reporter)
	if rep == nil {
		return
	}
	at := rep.r.clock()
	rep.r.mu.Lock()
	defer rep.r.mu.Unlock()
	rep.l.state.outcome = &Outcome{Kind: kind, Text: text, At: at}
}
