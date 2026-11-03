package library

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/library/db"
)

// WithHistory sets the Log that changes to the Library are written to: a Title added or removed, a Version added or
// removed, and monitoring changed. Without it they record nothing. The trigger is the one the context carries
// (history.WithTrigger); the Reason is worded from it here.
func (s *Service) WithHistory(h *history.Service) *Service {
	s.history = h
	return s
}

type quietKey struct{}

// Quiet returns a context whose Library changes write no Log entry of their own. A caller that records one entry for
// the whole of what it does (a bulk action) uses it, so the Log does not say the same thing once per Title.
func Quiet(ctx context.Context) context.Context { return context.WithValue(ctx, quietKey{}, true) }

func quiet(ctx context.Context) bool { q, _ := ctx.Value(quietKey{}).(bool); return q }

// off reports whether a change writes no entry: no Log set, or a Quiet context.
func (s *Service) off(ctx context.Context) bool { return s.history == nil || quiet(ctx) }

// record writes one entry unless the change is off. It never fails the change it describes: Record only logs.
func (s *Service) record(ctx context.Context, ev history.Event) {
	if s.off(ctx) {
		return
	}
	s.history.Record(ctx, ev)
}

// why words an entry's Reason from the trigger the context carries; what is the change in the entry's own terms.
func why(ctx context.Context, what string) string { return reasonOf(history.TriggerOf(ctx), what) }

// reasonOf words why a change happened from who or what started it: "chosen by hand: added to the Library",
// "request: asked for via Plex, added to the Library", "rule: watch ahead, monitoring was changed".
func reasonOf(t history.Trigger, what string) string {
	switch t.Kind {
	case history.TriggerPerson, history.TriggerAPIKey:
		return "chosen by hand: " + what
	case history.TriggerRequest:
		if t.Via != "" {
			return "request: asked for via " + t.Via + ", " + what
		}
		return "request: " + what
	}
	name := string(t.Kind)
	if t.Via != "" {
		name = t.Via
	}
	return string(t.Kind) + ": " + name + ", " + what
}

func dataOf(m map[string]any) json.RawMessage {
	b, _ := json.Marshal(m)
	return b
}

// titleLabel is `Movie "Name"` or `Series "Name"` for the Log.
func titleLabel(kind Kind, name string) string {
	k := "Movie"
	if kind == Series {
		k = "Series"
	}
	return fmt.Sprintf("%s %q", k, name)
}

// nameOf reads a Title's kind and name for the Log; "" when it cannot be read.
func (s *Service) nameOf(ctx context.Context, id int64) (Kind, string) {
	t, err := db.New(s.st.Read()).GetTitle(ctx, id)
	if err != nil {
		return "", ""
	}
	return Kind(t.Kind), t.Title
}

func (s *Service) recordTitleAdded(ctx context.Context, id int64, kind Kind, name string, versions int) {
	s.record(ctx, history.Event{
		Kind: history.TitleAdded, TitleID: id,
		Message: fmt.Sprintf("Added %s to the Library with %s", titleLabel(kind, name), plural(versions, "Version")),
		Data:    dataOf(map[string]any{"kind": string(kind), "title": name, "versions": versions}),
		Reason:  why(ctx, "added to the Library"),
	})
}

// recordMonitoring writes a monitoring entry of the given scope ("title", "season", "episodes", "options").
func (s *Service) recordMonitoring(ctx context.Context, id int64, scope, message string, data map[string]any) {
	if s.off(ctx) {
		return
	}
	data["scope"] = scope
	s.record(ctx, history.Event{
		Kind: history.MonitoringChanged, TitleID: id, Message: message, Data: dataOf(data), Reason: why(ctx, "monitoring was changed"),
	})
}

func plural(n int, noun string) string {
	if n == 1 {
		return "1 " + noun
	}
	return fmt.Sprintf("%d %ss", n, noun)
}

func onOff(on bool) string {
	if on {
		return "monitored"
	}
	return "unmonitored"
}
