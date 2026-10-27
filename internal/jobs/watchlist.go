package jobs

import (
	"context"
	"time"
)

// Watchlist is Watchlist sync (ADR 0019): it reads the Plex Watchlists of the
// owner and of the friends who may request, and makes a Request for each title
// added since it first read that account's. It does nothing while the
// `watchlist` switch is off.
const Watchlist = "watchlist"

const watchlistEvery = 10 * time.Minute

// WatchlistLoop is the Watchlist sync loop around its pass; app registers it
// with Runner.Add, since the pass is built from what the API module holds.
func WatchlistLoop(run func(ctx context.Context) error) Loop {
	return Loop{Name: Watchlist, Run: run, Schedule: Schedule{Every: watchlistEvery}}
}
