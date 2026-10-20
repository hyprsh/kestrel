package jobs

import (
	"context"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/imports"
	"github.com/hyprsh/kestrel/internal/library"
)

// The loops Standard registers.
const (
	// Poll follows the download client: every 10 s while any Grab is downloading,
	// every 5 min otherwise, and right after a Grab.
	Poll = "poll"
	// Search is the sweep: it searches what the library says is due, the
	// Wanted Versions first and then the Filled ones due an Upgrade, and it
	// serves search on add, "Search all Wanted" and retries.
	Search = "search"
	// Import imports finished downloads with two workers; it wakes when a
	// poll sees a download finish and retries stalled Imports by their backoff.
	Import = "import"
	// Prune deletes routine events older than 30 days and expired sessions, once
	// a day: checked hourly, it runs when the last run is over 24 h old.
	Prune = "prune"
	// RSS reads every indexer's feed and grabs what the library wants from it.
	RSS = "rss"
	// Health runs the health checks (disk, Root folders, indexers, the download client) every 5 min.
	Health = "health"
	// Updates asks GitHub once a day for a newer release and security advisories.
	Updates = "updates"
	// Trash checks for newer TRaSH Custom Formats and profiles once a day (a Settings switch turns the updating off).
	Trash = "trash"
)

// Cadences. How long a Version waits between missing and Upgrade searches is
// the library's (library.NextMissing, library.UpgradeEvery); the loop only wakes
// to see what is due.
const (
	pollBusy    = 10 * time.Second
	pollIdle    = 5 * time.Minute
	searchEvery = 5 * time.Minute
	rssEvery    = 15 * time.Minute
	// upgradesPerPass keeps the Upgrade sweep from searching a whole library on
	// one pass; the oldest-searched Versions go first and the rest follow on later passes.
	upgradesPerPass = 5
	importEvery     = time.Minute
	// importWorkers is how many Imports run at once.
	importWorkers = 2
	pruneCheck    = time.Hour
	healthEvery   = 5 * time.Minute
)

// HealthChecker is what the loops need of the health module.
type HealthChecker interface {
	RunChecks(ctx context.Context) error
}

// UpdateChecker is what the loops need of the updates module.
type UpdateChecker interface {
	Check(ctx context.Context) error
}

// TrashChecker is what the loops need of the trash module.
type TrashChecker interface {
	Check(ctx context.Context) error
}

// Acquirer is what the loops need of the acquire module.
type Acquirer interface {
	Poll(ctx context.Context) (acquire.PollResult, error)
	// Reconcile is the poll at startup, where a Grab the client lost is lost at once.
	Reconcile(ctx context.Context) (acquire.PollResult, error)
	SearchWanted(ctx context.Context, titleID int64, versionIDs []int64) (acquire.Outcome, error)
	// SearchNew is the search on add, which is not a sweep.
	SearchNew(ctx context.Context, titleID int64, versionIDs []int64) (acquire.Outcome, error)
	SearchUpgrades(ctx context.Context, titleID int64, versionIDs []int64) (acquire.Outcome, error)
	SyncRSS(ctx context.Context) (acquire.RSSOutcome, error)
	// StopSearches cancels the searches started by hand (Search now) and waits for them.
	StopSearches()
}

// ImportSource is what the Import loop needs of the acquire module: the Grabs
// that are due and a place to record how each Import ended.
type ImportSource interface {
	DueImports(ctx context.Context) ([]acquire.ImportJob, error)
	RecordImport(ctx context.Context, grabID int64, canRemove bool, o acquire.ImportOutcome) error
}

// Importer is the imports module.
type Importer interface {
	Import(ctx context.Context, g imports.Grab) imports.Result
}

// Library is what the loops need of the library module.
type Library interface {
	DueMissing(ctx context.Context, now time.Time) ([]library.Due, error)
	MarkMissingSearched(ctx context.Context, versionID int64, at time.Time, failed bool) error
	DueUpgrades(ctx context.Context, now time.Time, limit int) ([]library.Due, error)
	MarkUpgradeSearched(ctx context.Context, versionID int64, at time.Time, failed bool) error
}

// History is what the loops need of the history module.
type History interface {
	Prune(ctx context.Context) (int64, error)
}

// DailyRefresher is the metadata refresher's loop pass.
type DailyRefresher interface {
	Daily(ctx context.Context) error
}

// Deps are the modules Standard strings together.
type Deps struct {
	// Refresher is optional; without it there is no metadata refresh loop.
	Refresher DailyRefresher
	Acquire   Acquirer
	Library   Library
	History   History
	// LastRun remembers when the daily loops (pruning, the update and TRaSH
	// checks) last ran; without it each runs at every hourly check.
	LastRun RefreshState
	// Sessions deletes expired sessions; optional.
	Sessions func(ctx context.Context) error
	// Health is optional; without it there is no health loop.
	Health HealthChecker
	// Updates is optional; without it there is no update check.
	Updates UpdateChecker
	// Trash is optional; without it there is no daily TRaSH check.
	Trash TrashChecker
	// Importer and ImportSource enable the Import loop; leave both nil for none.
	Importer     Importer
	ImportSource ImportSource
	Clock        func() time.Time
	Logger       *slog.Logger
}

// Standard returns a Runner with Kestrel's loops. Later tickets add theirs
// here, one Add call each.
func Standard(d Deps) *Runner {
	if d.Clock == nil {
		d.Clock = time.Now
	}
	r := New(d.Logger)
	r.OnStop(d.Acquire.StopSearches)

	var downloading atomic.Bool
	r.Add(Loop{
		Name: Poll,
		Run: func(ctx context.Context) error {
			res, err := d.Acquire.Poll(ctx)
			downloading.Store(res.Active)
			if res.Changed > 0 {
				r.Kick(Import)
			}
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
	// start brings their state and progress up to date, and fails (and retries)
	// the Grabs the client no longer has.
	r.OnStart("poll the download client", func(ctx context.Context) error {
		res, err := d.Acquire.Reconcile(ctx)
		downloading.Store(res.Active)
		return err
	})

	r.Add(Loop{
		Name:  Search,
		Run:   func(ctx context.Context) error { return searchDue(ctx, r, d) },
		Every: func() time.Duration { return searchEvery },
	})
	if d.Importer != nil && d.ImportSource != nil {
		r.Add(Loop{
			Name:  Import,
			Run:   func(ctx context.Context) error { return importDue(ctx, r, d) },
			Every: func() time.Duration { return importEvery },
		})
	}
	if d.History != nil {
		r.Add(Loop{
			Name:  Prune,
			Run:   func(ctx context.Context) error { return prune(ctx, d) },
			Every: func() time.Duration { return pruneCheck },
		})
	}

	if d.Health != nil {
		r.Add(Loop{
			Name:  Health,
			Run:   d.Health.RunChecks,
			Every: func() time.Duration { return healthEvery },
		})
	}

	if d.Refresher != nil {
		r.Add(Loop{
			Name:  Refresh,
			Run:   d.Refresher.Daily,
			Every: func() time.Duration { return refreshCheckEvery },
		})
	}
	if d.Trash != nil {
		r.Add(Loop{
			Name:  Trash,
			Run:   daily(d.LastRun, trashStateKey, d.Clock, d.Trash.Check),
			Every: func() time.Duration { return dailyCheck },
		})
	}

	if d.Updates != nil {
		r.Add(Loop{
			Name:  Updates,
			Run:   daily(d.LastRun, updatesStateKey, d.Clock, d.Updates.Check),
			Every: func() time.Duration { return dailyCheck },
		})
	}

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

// importDue imports every Grab that is due, importWorkers at a time, and
// records each outcome. imports never touches Grabs; acquire does.
func importDue(ctx context.Context, r *Runner, d Deps) error {
	due, err := d.ImportSource.DueImports(ctx)
	if err != nil {
		return err
	}
	work := make(chan acquire.ImportJob)
	var wg sync.WaitGroup
	for range min(importWorkers, len(due)) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range work {
				res := d.Importer.Import(ctx, imports.Grab{
					ID: j.ID, TitleID: j.TitleID, VersionID: j.VersionID, ReleaseName: j.ReleaseName,
					Parsed: []byte(j.Parsed), SourcePath: j.OutputPath, CanRemove: j.CanRemove, Overridden: j.Overridden,
				})
				if ctx.Err() != nil {
					continue // shutting down: the Grab stays importing and is redone
				}
				out := acquire.ImportOutcome{Status: acquire.ImportStatus(res.Status), Reason: res.Reason, Path: res.Path, Inconclusive: res.Inconclusive}
				for _, e := range res.Episodes {
					out.Episodes = append(out.Episodes, acquire.EpisodeOutcome{
						EpisodeID: e.EpisodeID, Season: e.Season, Number: e.Number, Status: acquire.ImportStatus(e.Status),
						Reason: e.Reason, File: e.File, Path: e.Path,
					})
				}
				if err := d.ImportSource.RecordImport(ctx, j.ID, j.CanRemove, out); err != nil {
					r.log.Warn("recording an Import failed", "grab", j.ID, "err", err)
				}
				if out.Status == acquire.ImportRejected {
					r.Kick(Poll) // the next best Release was grabbed: follow it
				}
			}
		}()
	}
	for _, j := range due {
		work <- j
	}
	close(work)
	wg.Wait()
	return nil
}

// searchDue is the sweep: each Title with a Wanted Version due is searched once,
// then the Filled Versions due an Upgrade, the one searched longest ago first.
// A searched Version moves its next search out, so a second pass finds nothing
// to do.
func searchDue(ctx context.Context, r *Runner, d Deps) error {
	now := d.Clock()
	grabbed := false
	missing, err := d.Library.DueMissing(ctx, now)
	if err != nil {
		return err
	}
	var fresh, due []library.Due
	for _, m := range missing {
		if m.Fresh {
			fresh = append(fresh, m)
		} else {
			due = append(due, m)
		}
	}
	// A new Version is searched at once, whatever the budget; the sweep after it obeys the 80 % stop.
	err = sweep(ctx, r, fresh, d.Acquire.SearchNew, d.Library.MarkMissingSearched, now, &grabbed)
	if err == nil {
		err = sweep(ctx, r, due, d.Acquire.SearchWanted, d.Library.MarkMissingSearched, now, &grabbed)
	}
	if err == nil {
		var upgrades []library.Due
		if upgrades, err = d.Library.DueUpgrades(ctx, now, upgradesPerPass); err == nil {
			err = sweep(ctx, r, upgrades, d.Acquire.SearchUpgrades, d.Library.MarkUpgradeSearched, now, &grabbed)
		}
	}
	if grabbed {
		r.Kick(Poll)
	}
	return err
}

// sweep searches each Title of due once, with the Versions of it that are due.
func sweep(
	ctx context.Context, r *Runner, due []library.Due,
	search func(ctx context.Context, titleID int64, versionIDs []int64) (acquire.Outcome, error),
	mark func(ctx context.Context, versionID int64, at time.Time, failed bool) error,
	now time.Time, grabbed *bool,
) error {
	var titles []int64
	byTitle := map[int64][]int64{}
	for _, x := range due {
		if _, seen := byTitle[x.TitleID]; !seen {
			titles = append(titles, x.TitleID)
		}
		byTitle[x.TitleID] = append(byTitle[x.TitleID], x.VersionID)
	}
	for _, id := range titles {
		out, err := search(ctx, id, byTitle[id])
		if err != nil {
			r.log.Warn("search for a Title failed", "title", id, "err", err)
		}
		*grabbed = *grabbed || len(out.Grabbed) > 0
		failed := err != nil || len(out.Failures) > 0
		for _, v := range out.Searched {
			if err := mark(ctx, v, now, failed); err != nil {
				return err
			}
		}
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
