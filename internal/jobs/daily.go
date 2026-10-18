package jobs

import (
	"context"
	"encoding/json"
	"time"
)

const (
	// updatesStateKey and trashStateKey hold when those checks last ran.
	updatesStateKey = "updates_state"
	trashStateKey   = "trash_state"
	// dailyCheck is how often a daily loop looks at whether it is due.
	dailyCheck = time.Hour
	dailyEvery = 24 * time.Hour
)

// daily makes run due once the last run, remembered under key in state, is over
// a day old; the loop calls it hourly. A failed run is not remembered, so the
// next hourly check tries again. Without state it runs every time it is called.
func daily(state RefreshState, key string, clock func() time.Time, run func(ctx context.Context) error) func(ctx context.Context) error {
	return func(ctx context.Context) error {
		now := clock()
		if state != nil {
			b, ok, err := state.Get(ctx, key)
			if err != nil {
				return err
			}
			if ok {
				var text string
				_ = json.Unmarshal(b, &text)
				if last, err := time.Parse(time.RFC3339, text); err == nil && now.Sub(last) < dailyEvery {
					return nil
				}
			}
		}
		if err := run(ctx); err != nil {
			return err
		}
		if state != nil {
			b, _ := json.Marshal(now.UTC().Format(time.RFC3339))
			return state.Put(ctx, key, b)
		}
		return nil
	}
}
