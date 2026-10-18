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
	// Search searches what the library says is due: search on add today,
	// the sweeps (#46) and RSS (#45) later.
	Search = "search"
	// Import imports finished downloads with two workers; it wakes when a
	// poll sees a download finish and retries stalled Imports by their backoff.
	Import = "import"
	// Prune deletes routine events older than 30 days, once a day.
	Prune = "prune"
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
	importEvery   = time.Minute
	// importWorkers is how many Imports run at once.
	importWorkers = 2
	pruneEvery    = 24 * time.Hour
)

// Acquirer is what the loops need of the acquire module.
type Acquirer interface {
	Poll(ctx context.Context) (acquire.PollResult, error)
	SearchWanted(ctx context.Context, titleID int64, versionIDs []int64) (acquire.Outcome, error)
	SyncRSS(ctx context.Context) (acquire.RSSOutcome, error)
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
	MarkMissingSearched(ctx context.Context, versionID int64, at, next time.Time) error
}

// History is what the loops need of the history module.
type History interface {
	Prune(ctx context.Context) (int64, error)
}

// Deps are the modules Standard strings together.
type Deps struct {
	Acquire Acquirer
	Library Library
	History History
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
	// start brings their state and progress up to date.
	r.OnStart("poll the download client", func(ctx context.Context) error { return r.Pass(ctx, Poll) })

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
			Run:   func(ctx context.Context) error { _, err := d.History.Prune(ctx); return err },
			Every: func() time.Duration { return pruneEvery },
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
					Parsed: []byte(j.Parsed), SourcePath: j.OutputPath, CanRemove: j.CanRemove,
				})
				if ctx.Err() != nil {
					continue // shutting down: the Grab stays importing and is redone
				}
				out := acquire.ImportOutcome{Status: acquire.ImportStatus(res.Status), Reason: res.Reason, Path: res.Path}
				for _, e := range res.Episodes {
					out.Episodes = append(out.Episodes, acquire.EpisodeOutcome{
						EpisodeID: e.EpisodeID, Season: e.Season, Number: e.Number, Status: acquire.ImportStatus(e.Status),
						Reason: e.Reason, File: e.File, Path: e.Path,
					})
				}
				if err := d.ImportSource.RecordImport(ctx, j.ID, j.CanRemove, out); err != nil {
					r.log.Warn("recording an Import failed", "grab", j.ID, "err", err)
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
