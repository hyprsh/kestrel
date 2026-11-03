package indexers

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
)

// The Log hears of an indexer when its state changes, not at each request: observe compares the conditions an
// indexer is in now with those it last told the Log of (state.shown) and writes one entry per difference. The
// request that made the difference supplies the trigger (a sweep, a person, RSS...); a condition that merely runs
// out (a pause ends, a day rolls over) is noticed by the next request or sweep check, which is then its trigger.
const (
	condPaused    = iota // searches or Grabs wait on a request limit
	condBackedOff        // failing: left alone for a while
	condSlow             // slow answers widened the gap
	condStopped          // sweeps stopped at 80 % of the daily budget
	numConds
)

var condWas = [numConds]string{"paused", "backed_off", "slow", "sweep_stopped"}

// observe returns the entries for the conditions st has entered or left since the Log was last told. It updates
// st.shown, so call it with s.mu held and hand the result to tell once the lock is released.
func (s *Service) observe(ctx context.Context, inst instances.Instance, st *state, now time.Time) []history.Event {
	if s.hist == nil {
		return nil
	}
	trigger := history.TriggerOr(ctx, history.Job(history.TriggerJob, "indexers"))
	var in [numConds]bool
	in[condPaused] = st.searchUntil.After(now) || st.grabUntil.After(now)
	in[condBackedOff] = st.backoffUntil.After(now) && st.last != nil
	in[condSlow] = st.widened > 0
	used, budget := st.budget(now, inst.Connection().Int("api_requests_per_day"))
	in[condStopped] = budget > 0 && used*100 >= budget*sweepShare

	var out []history.Event
	for c := range numConds {
		if in[c] == st.shown[c] {
			continue
		}
		st.shown[c] = in[c]
		ev := history.Event{Trigger: trigger}
		data := map[string]any{"indexer_id": inst.ID, "indexer_name": inst.Name}
		switch {
		case !in[c]:
			ev.Kind, ev.Reason = history.IndexerRecovered, st.recoveredReason(c)
			ev.Message = fmt.Sprintf("%s recovered", inst.Name)
			data["was"] = condWas[c]
		case c == condPaused:
			ev.Kind = history.IndexerPaused
			scope, until := "searches", st.searchUntil
			switch {
			case st.searchUntil.After(now) && st.grabUntil.After(now):
				scope, until = "searches and Grabs", later(st.searchUntil, st.grabUntil)
			case st.grabUntil.After(now):
				scope, until = "Grabs", st.grabUntil
			}
			ev.Message = fmt.Sprintf("%s paused: %s wait", inst.Name, scope)
			ev.Reason = fmt.Sprintf("limit: the indexer's request limit was reached; %s wait until %s", scope, until.UTC().Format("15:04 UTC"))
			data["scope"], data["until"] = scope, until.UTC().Format(time.RFC3339)
		case c == condBackedOff:
			ev.Kind = history.IndexerBackedOff
			wait := st.backoffUntil.Sub(now).Round(time.Second)
			ev.Message = fmt.Sprintf("%s backed off for %s", inst.Name, wait)
			ev.Reason = fmt.Sprintf("error: %s (failure %d in a row); left alone for %s", st.last.Message, st.failures, wait)
			data["failures"], data["until"] = st.failures, st.backoffUntil.UTC().Format(time.RFC3339)
		case c == condSlow:
			ev.Kind = history.IndexerSlow
			gap := st.gap(inst)
			ev.Message = fmt.Sprintf("%s is slow: searches %s apart", inst.Name, gap)
			ev.Reason = fmt.Sprintf("slow: an answer took over %d times the usual %s; the gap between searches is now %s", slowFactor, st.usual.Round(time.Millisecond), gap)
			data["gap_seconds"] = gap.Seconds()
		case c == condStopped:
			ev.Kind = history.IndexerSweepStopped
			ev.Message = fmt.Sprintf("Sweeps stopped for %s", inst.Name)
			ev.Reason = fmt.Sprintf("budget: %d of %d searches used today, and sweeps stop at %d %%", used, budget, sweepShare)
			data["used"], data["budget"] = used, budget
		}
		ev.Data, _ = json.Marshal(data)
		out = append(out, ev)
	}
	st.cfgChanged = false
	return out
}

// recoveredReason says why condition c ended.
func (st *state) recoveredReason(c int) string {
	if st.cfgChanged {
		return "recovered: the indexer's connection settings were changed"
	}
	switch c {
	case condPaused:
		return "recovered: the pause ended"
	case condBackedOff:
		if st.failures == 0 {
			return "recovered: it answered a search"
		}
		return "recovered: the back-off ended"
	case condSlow:
		return "recovered: answers came quickly again, so the gap is back to the configured one"
	}
	return "recovered: the daily budget rolled over or the indexer reported a fresh count"
}

func later(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}

// tell records the entries observe returned. It runs without s.mu, on a context the request's end cannot cancel:
// the entry is about the indexer, not the request.
func (s *Service) tell(ctx context.Context, evs []history.Event) {
	if len(evs) == 0 {
		return
	}
	s.mu.Lock()
	h := s.hist
	s.mu.Unlock()
	ctx = context.WithoutCancel(ctx)
	for _, ev := range evs {
		h.Record(ctx, ev)
	}
}
