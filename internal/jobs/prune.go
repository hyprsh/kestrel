package jobs

import (
	"context"
	"errors"
)

// pruneStateKey is the settings key holding when pruning last ran.
const pruneStateKey = "prune_state"

// prune is the Prune loop's pass: routine events older than 30 days, expired
// sessions and folder changes older than 30 days go, once the last run is over a day old (see daily).
func prune(ctx context.Context, d Deps) error {
	return daily(d.LastRun, pruneStateKey, d.Clock, func(ctx context.Context) error {
		_, err := d.History.Prune(ctx)
		if d.Sessions != nil {
			err = errors.Join(err, d.Sessions(ctx))
		}
		if d.FolderChanges != nil {
			err = errors.Join(err, d.FolderChanges(ctx))
		}
		return err
	})(ctx)
}
