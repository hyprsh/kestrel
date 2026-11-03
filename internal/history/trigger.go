package history

import (
	"context"
	"strings"
)

// TriggerKind says who or what started the action an event records.
type TriggerKind string

// Trigger kinds. The first two are actors; the others are jobs and rules. The set grows; clients tolerate
// unknown kinds. The Log's `by:` filter names them (`by:person`, `by:sweep`, `by:retry`).
const (
	// TriggerPerson: a signed-in person, named in Actor, from the screen or API call in Via.
	TriggerPerson TriggerKind = "person"
	// TriggerAPIKey: a caller using the API key, with the API call in Via.
	TriggerAPIKey TriggerKind = "api_key"
	// TriggerSweep: the search sweep (the missing search, the search on add and the Upgrade sweep).
	TriggerSweep TriggerKind = "sweep"
	// TriggerRSS: the RSS sweep.
	TriggerRSS TriggerKind = "rss"
	// TriggerImport: the Import loop.
	TriggerImport TriggerKind = "import"
	// TriggerRetry: the retry that follows a failed or rejected Grab, or a Cancel with blocklist.
	TriggerRetry TriggerKind = "retry"
	// TriggerRequest: a Request, with where it came from in Via.
	TriggerRequest TriggerKind = "request"
	// TriggerRule: a rule acting on its own (Watch ahead, Long Missing, cleanup), named in Via.
	TriggerRule TriggerKind = "rule"
	// TriggerStartup: Kestrel starting up or migrating.
	TriggerStartup TriggerKind = "startup"
	// TriggerJob: any other background loop, named in Via.
	TriggerJob TriggerKind = "job"
)

// Trigger is who or what started the action an event records.
type Trigger struct {
	Kind TriggerKind
	// Actor names the person for TriggerPerson; empty otherwise.
	Actor string
	// Via is the screen or API call for an actor, the Request's source, the rule's or loop's name for the rest.
	Via string
}

// Person is a signed-in person acting through the screen or API call via.
func Person(name, via string) Trigger { return Trigger{Kind: TriggerPerson, Actor: name, Via: via} }

// APIKey is a caller using the API key to make the API call via.
func APIKey(via string) Trigger { return Trigger{Kind: TriggerAPIKey, Via: via} }

// Job is a background job or rule of the kind, named in via when that adds something ("" for none).
func Job(kind TriggerKind, via string) Trigger { return Trigger{Kind: kind, Via: via} }

// IsZero reports whether no trigger is set.
func (t Trigger) IsZero() bool { return t.Kind == "" }

type triggerKey struct{}

// WithTrigger returns a context whose Record calls take t as their trigger when the event names none. An API request
// carries its person or key, and a loop's pass its job, so the modules below need not pass it down.
func WithTrigger(ctx context.Context, t Trigger) context.Context {
	return context.WithValue(ctx, triggerKey{}, t)
}

// TriggerOf is the trigger ctx carries, zero when none.
func TriggerOf(ctx context.Context) Trigger {
	t, _ := ctx.Value(triggerKey{}).(Trigger)
	return t
}

// Key is the trigger as one short string, for state that must carry a trigger across a restart or to another
// module ("person:navi", "api_key", "sweep"); TriggerFromKey reads it back. Via is not kept.
func (t Trigger) Key() string {
	if t.Actor != "" {
		return string(t.Kind) + ":" + t.Actor
	}
	return string(t.Kind)
}

// TriggerFromKey reads what Key wrote, giving it the screen or call via; the zero Trigger for "".
func TriggerFromKey(key, via string) Trigger {
	kind, actor, _ := strings.Cut(key, ":")
	return Trigger{Kind: TriggerKind(kind), Actor: actor, Via: via}
}

// TriggerOr is the trigger ctx carries, or fallback when it carries none: for work that may run on a context
// detached from the call that started it (a background scan, a refresh).
func TriggerOr(ctx context.Context, fallback Trigger) Trigger {
	if t := TriggerOf(ctx); !t.IsZero() {
		return t
	}
	return fallback
}
