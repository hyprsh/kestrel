package jobs

import (
	"context"
	"log/slog"
	"sync/atomic"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/library"
)

// The loops Standard registers.
const (
	// Poll follows the download client: every 10 s while any Grab is downloading,
	// every 5 min otherwise, and right after a Grab.
	Poll = "poll"
	// Search searches what the library says is due: search on add today,
	// the sweeps (#46) and RSS (#45) later.
	Search = "search"
	// RSS reads every indexer's feed and grabs what the library wants from it.
	RSS = "rss"
)

// Cadences. missingRetry and missingFailed are placeholders until the sweep
// ticket sets the real missing and upgrade cadences.
const (
	pollBusy      = 10 * time.Second
	pollIdle      = 5 * time.Minute
	searchEvery   = 5 * time.Minute
	rssEvery      = 15 * time.Minute
	missingRetry  = 6 * time.Hour
	missingFailed = 15 * time.Minute
)

// Acquirer is what the loops need of the acquire module.
type Acquirer interface {
	Poll(ctx context.Context) (acquire.PollResult, error)
	SearchWanted(ctx context.Context, titleID int64, versionIDs []int64) (acquire.Outcome, error)
	SyncRSS(ctx context.Context) (acquire.RSSOutcome, error)
}

// Library is what the loops need of the library module.
type Library interface {
	DueMissing(ctx context.Context, now time.Time) ([]library.Due, error)
	MarkMissingSearched(ctx context.Context, versionID int64, at, next time.Time) error
}

// Deps are the modules Standard strings together.
type Deps struct {
	Acquire Acquirer
	Library Library
	Clock   func() time.Time
	Logger  *slog.Logger
}

// Standard returns a Runner with Kestrel's loops. Later tickets add theirs
// here, one Add call each.
func Standard(d Deps) *Runner {
	if d.Clock == nil {
		d.Clock = time.Now
	}
	r := New(d.Logger)

	var downloading atomic.Bool
	r.Add(Loop{
		Name: Poll,
		Run: func(ctx context.Context) error {
			res, err := d.Acquire.Poll(ctx)
			downloading.Store(res.Active)
			return err
		},
		Every: func() time.Duration {
			if downloading.Load() {
				return pollBusy
			}
			return pollIdle
		},
	})
	// A restart finds in-flight Grabs in their rows; one poll before the loops
	// start brings their state and progress up to date.
	r.OnStart("poll the download client", func(ctx context.Context) error { return r.Pass(ctx, Poll) })

	r.Add(Loop{
		Name:  Search,
		Run:   func(ctx context.Context) error { return searchDue(ctx, r, d) },
		Every: func() time.Duration { return searchEvery },
	})

	r.Add(Loop{
		Name: RSS,
		Run: func(ctx context.Context) error {
			out, err := d.Acquire.SyncRSS(ctx)
			for _, f := range out.Failures {
				r.log.Warn("an indexer's RSS feed could not be read", "indexer", f.IndexerName, "code", f.Code, "err", f.Message)
			}
			if len(out.Grabbed) > 0 {
				r.Kick(Poll)
			}
			return err
		},
		Every: func() time.Duration { return rssEvery },
	})
	return r
}

// searchDue searches each Title with a due Version once. A searched Version
// moves its next search out, so a second pass finds nothing to do.
func searchDue(ctx context.Context, r *Runner, d Deps) error {
	now := d.Clock()
	due, err := d.Library.DueMissing(ctx, now)
	if err != nil {
		return err
	}
	var titles []int64
	byTitle := map[int64][]int64{}
	for _, x := range due {
		if _, seen := byTitle[x.TitleID]; !seen {
			titles = append(titles, x.TitleID)
		}
		byTitle[x.TitleID] = append(byTitle[x.TitleID], x.VersionID)
	}
	grabbed := false
	for _, id := range titles {
		out, err := d.Acquire.SearchWanted(ctx, id, byTitle[id])
		if err != nil {
			r.log.Warn("search for a Title failed", "title", id, "err", err)
		}
		grabbed = grabbed || len(out.Grabbed) > 0
		next := now.Add(missingRetry)
		if err != nil || len(out.Failures) > 0 {
			next = now.Add(missingFailed)
		}
		for _, v := range out.Searched {
			if err := d.Library.MarkMissingSearched(ctx, v, now, next); err != nil {
				return err
			}
		}
	}
	if grabbed {
		r.Kick(Poll)
	}
	return nil
}

// Every is the interval a loop would wait now, for tests.
func (r *Runner) Every(name string) time.Duration {
	r.mu.Lock()
	l := r.loops[name]
	r.mu.Unlock()
	if l == nil {
		return 0
	}
	return l.Loop.Every()
}
