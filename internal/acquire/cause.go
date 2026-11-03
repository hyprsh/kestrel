package acquire

import (
	"context"

	"github.com/hyprsh/kestrel/internal/history"
)

// A search carries why it runs in its context: the trigger is history's (WithTrigger), the reason is this
// package's. The Searched event of the search and the `grab` event of each Grab it makes both take them, so
// the Log says "retry: import of X rejected: language" on the search and on the Grab it found.
type reasonKey struct{}

// withReason returns ctx carrying why the search runs.
func withReason(ctx context.Context, reason string) context.Context {
	return context.WithValue(ctx, reasonKey{}, reason)
}

// reasonOf is why the search ran, "" when its caller said nothing.
func reasonOf(ctx context.Context) string {
	r, _ := ctx.Value(reasonKey{}).(string)
	return r
}

// Reasons of the searches Kestrel starts on its own.
const (
	reasonDue     = "due: its next search time came"
	reasonNew     = "new: the first search of a Version just added"
	reasonUpgrade = "due: its next Upgrade search came"
)

// sweepTrigger is the trigger of a sweep's search when its context carries none (the sweep sets it for its pass).
var sweepTrigger = history.Job(history.TriggerSweep, "")

// retryTrigger is the trigger of the search that replaces a Grab that failed, was rejected or was canceled and blocklisted.
var retryTrigger = history.Job(history.TriggerRetry, "")

// actorOf names who is acting for a Log reason: the person, "the API key" or the job.
func actorOf(ctx context.Context) string {
	t := history.TriggerOf(ctx)
	switch {
	case t.Actor != "":
		return t.Actor
	case t.Kind == history.TriggerAPIKey:
		return "the API key"
	case t.Kind != "":
		return "the " + string(t.Kind)
	}
	return "someone"
}

// sweepCause is the context of a search Kestrel starts on its own: the trigger the sweep set (else the sweep) and
// why this search runs. A person's trigger on a due search means they asked for it from the Library (a bulk Search
// made the Versions due now; the sweep carries the person to the search).
func sweepCause(ctx context.Context, reason string) context.Context {
	t := history.TriggerOr(ctx, sweepTrigger)
	if t.Kind == history.TriggerPerson && reason == reasonDue {
		reason = "bulk: " + t.Actor + " asked to search these Titles from the Library"
	}
	return history.WithTrigger(withReason(ctx, reason), t)
}
