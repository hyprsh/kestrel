package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

// pruneStateKey is the settings key holding when pruning last ran.
const pruneStateKey = "prune_state"

// prune is the Prune loop's pass: routine events older than 30 days and expired
// sessions go, once the last run is over a day old. A failed run is tried again
// at the next hourly check.
func prune(ctx context.Context, d Deps) error {
	now := d.Clock()
	if d.PruneState != nil {
		b, ok, err := d.PruneState.Get(ctx, pruneStateKey)
		if err != nil {
			return err
		}
		if ok {
			var text string
			_ = json.Unmarshal(b, &text)
			if last, err := time.Parse(time.RFC3339, text); err == nil && now.Sub(last) < pruneEvery {
				return nil
			}
		}
	}
	_, err := d.History.Prune(ctx)
	if d.Sessions != nil {
		err = errors.Join(err, d.Sessions(ctx))
	}
	if err != nil {
		return err
	}
	if d.PruneState != nil {
		b, _ := json.Marshal(now.UTC().Format(time.RFC3339))
		return d.PruneState.Put(ctx, pruneStateKey, b)
	}
	return nil
}
