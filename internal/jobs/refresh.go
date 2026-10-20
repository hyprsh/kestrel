package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/hyprsh/kestrel/internal/health"
	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/imports"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
)

// Refresh keeps Titles' metadata current: every day an incremental pass over
// what the providers say changed, a full refresh of any Title not refreshed
// for 30 days. It is checked hourly and runs once the last pass is a day old.
const Refresh = "refresh"

const (
	refreshCheckEvery = time.Hour
	refreshEvery      = 24 * time.Hour
	// fullRefreshAfter is how stale a Title may get before it is refreshed
	// whether or not a provider reports a change (TMDB's terms ask for under six months).
	fullRefreshAfter = 30 * 24 * time.Hour
	// changesWindow is how far back TMDB's changes feed reaches.
	changesWindow = 14 * 24 * time.Hour
	// metadataWorkers is how many Titles refresh at once.
	metadataWorkers = 2
	// refreshStateKey is the settings key holding when the last daily pass ran.
	refreshStateKey = "metadata_refresh"
)

// RefreshLibrary is what a refresh needs of the library module.
type RefreshLibrary interface {
	Refreshable(ctx context.Context) ([]library.RefreshRef, error)
	Get(ctx context.Context, id int64, view library.View) (library.Detail, error)
	RefreshMovie(ctx context.Context, id int64, r library.MovieRefresh) (library.Refreshed, error)
	RefreshSeries(ctx context.Context, id int64, r library.SeriesRefresh) (library.Refreshed, error)
	SetMetadataFrozen(ctx context.Context, id int64, frozen bool) error
}

// TitleRenamer is the imports module's Rename.
type TitleRenamer interface {
	Rename(ctx context.Context, titleID int64) (imports.Renamed, error)
}

// RefreshState keeps the time of the last daily pass. *settings.Settings satisfies it.
type RefreshState interface {
	Get(ctx context.Context, key string) ([]byte, bool, error)
	Put(ctx context.Context, key string, value []byte) error
}

// RefreshHealth is what a refresh needs of the health module.
type RefreshHealth interface {
	Raise(ctx context.Context, is health.Issue) error
	Clear(ctx context.Context, key string) error
}

// RefresherDeps are what NewRefresher needs.
type RefresherDeps struct {
	Library RefreshLibrary
	Meta    metadata.Provider
	TVDB    metadata.TVDBProvider
	Renamer TitleRenamer
	State   RefreshState
	// Primary is the household's Primary Language (ISO 639-1).
	Primary func(ctx context.Context) (string, error)
	// History and Health are optional.
	History *history.Service
	Health  RefreshHealth
	Clock   func() time.Time
	Logger  *slog.Logger
}

// Refresher refreshes Titles from the metadata providers and renames what
// their names say.
type Refresher struct {
	d  RefresherDeps
	wg sync.WaitGroup
	// sem holds the metadata workers.
	sem chan struct{}
}

// NewRefresher returns a Refresher.
func NewRefresher(d RefresherDeps) *Refresher {
	if d.Clock == nil {
		d.Clock = time.Now
	}
	if d.Logger == nil {
		d.Logger = slog.Default()
	}
	return &Refresher{d: d, sem: make(chan struct{}, metadataWorkers)}
}

// goneUpstream says the provider no longer has the Title: deleted, or merged
// into another entry.
func goneUpstream(err error) bool {
	var me *metadata.Error
	return errors.As(err, &me) && me.Code == metadata.CodeNotFound
}

// SetFrozen freezes a Title's metadata, so a refresh leaves it alone, or
// unfreezes it. Freezing is "Keep as is": it settles the Title gone upstream
// row. It returns library.ErrNotFound for a Title that does not exist.
func (r *Refresher) SetFrozen(ctx context.Context, id int64, frozen bool) error {
	if err := r.d.Library.SetMetadataFrozen(ctx, id, frozen); err != nil {
		return err
	}
	if !frozen || r.d.Health == nil {
		return nil
	}
	return r.d.Health.Clear(ctx, health.GoneUpstreamKey(id))
}

// Refresh refreshes one Title. A frozen Title is left alone. When the English
// title or year changed, its folder and files are renamed with it. When the
// provider no longer has the Title, "Title gone upstream" is raised and the
// stored data stays as it is.
func (r *Refresher) Refresh(ctx context.Context, id int64) error {
	d, err := r.d.Library.Get(ctx, id, library.View{Now: r.d.Clock()})
	if err != nil {
		return err
	}
	if d.MetadataFrozen {
		return nil
	}
	primary, err := r.d.Primary(ctx)
	if err != nil {
		return err
	}
	var res library.Refreshed
	switch d.Kind {
	case library.Movie:
		var det metadata.MovieDetails
		if det, err = r.d.Meta.Movie(ctx, d.TMDBID); err == nil {
			res, err = r.d.Library.RefreshMovie(ctx, id, library.MovieRefresh{Details: det, PrimaryLanguage: primary})
		}
	default:
		var det metadata.SeriesDetails
		var tv metadata.TVDBSeries
		if det, err = r.d.Meta.Series(ctx, d.TMDBID); err == nil {
			if tv, err = r.d.TVDB.Series(ctx, d.TVDBID); err == nil {
				res, err = r.d.Library.RefreshSeries(ctx, id, library.SeriesRefresh{TMDB: det, TVDB: tv, PrimaryLanguage: primary})
			}
		}
	}
	if goneUpstream(err) {
		return r.raiseGone(ctx, d)
	}
	if err != nil {
		return err
	}
	if r.d.Health != nil {
		if err := r.d.Health.Clear(ctx, health.GoneUpstreamKey(id)); err != nil {
			r.d.Logger.Warn("clearing a Title gone upstream failed", "title", id, "err", err)
		}
	}
	if !res.Renamed {
		return nil
	}
	renamed, err := r.d.Renamer.Rename(ctx, id)
	if err != nil {
		return fmt.Errorf("rename %q: %w", d.Title, err)
	}
	if renamed.Changed {
		data, _ := json.Marshal(map[string]any{"from": d.Folder, "to": renamed.Folder, "files": renamed.Files})
		r.d.History.Record(ctx, history.Event{
			Kind: history.Renamed, TitleID: id, Data: data,
			Message: fmt.Sprintf("Renamed %q to %q (%d files)", d.Folder, renamed.Folder, renamed.Files),
		})
	}
	return nil
}

func (r *Refresher) raiseGone(ctx context.Context, d library.Detail) error {
	if r.d.Health == nil {
		return nil
	}
	name := d.Title
	if name == "" {
		name = d.OriginalTitle
	}
	return r.d.Health.Raise(ctx, health.Issue{
		Key: health.GoneUpstreamKey(d.ID), Kind: health.KindGoneUpstream, Severity: health.Warning, Subject: health.Subject{TitleID: d.ID},
		Message: fmt.Sprintf("%s is gone upstream: the metadata provider no longer has it", name),
	})
}

// Enqueue refreshes a Title in the background, with at most two Titles in
// flight, and returns at once.
func (r *Refresher) Enqueue(id int64) {
	r.wg.Add(1)
	go func() {
		defer r.wg.Done()
		r.sem <- struct{}{}
		defer func() { <-r.sem }()
		if err := r.Refresh(context.WithoutCancel(context.Background()), id); err != nil {
			r.d.Logger.Warn("refreshing a Title failed", "title", id, "err", err)
		}
		// The live views reload the Title whether or not its names changed: the
		// stream learns of it from the events log (ADR 0010).
		r.d.History.Record(context.WithoutCancel(context.Background()), history.Event{
			Kind: history.TitleRefreshed, TitleID: id, Message: "Refreshed from the metadata providers",
		})
	}()
}

// Wait blocks until every enqueued refresh has finished.
func (r *Refresher) Wait() { r.wg.Wait() }

// Daily is the loop's pass. It does nothing until the last pass is a day old,
// then refreshes every Title a provider reports changed since, plus every
// Title not refreshed for 30 days, two at a time. A pass that cannot read a
// change feed fails whole and is tried again at the next hourly check.
func (r *Refresher) Daily(ctx context.Context) error {
	now := r.d.Clock()
	last, err := r.lastRun(ctx)
	if err != nil {
		return err
	}
	if !last.IsZero() && now.Sub(last) < refreshEvery {
		return nil
	}
	since := last
	if since.IsZero() || now.Sub(since) > changesWindow {
		since = now.Add(-changesWindow)
	}
	refs, err := r.d.Library.Refreshable(ctx)
	if err != nil {
		return err
	}
	var movies, series, tvdb map[int]bool
	for _, x := range refs {
		if x.Kind == library.Movie && movies == nil {
			ids, err := r.d.Meta.Changes(ctx, metadata.Movie, since)
			if err != nil {
				return err
			}
			movies = set(ids)
		}
		if x.Kind == library.Series && series == nil {
			ids, err := r.d.Meta.Changes(ctx, metadata.Series, since)
			if err != nil {
				return err
			}
			series = set(ids)
			tids, err := r.d.TVDB.Updates(ctx, since)
			if err != nil {
				return err
			}
			tvdb = set(tids)
		}
	}
	var due []int64
	for _, x := range refs {
		changed := now.Sub(x.RefreshedAt) > fullRefreshAfter
		switch x.Kind {
		case library.Movie:
			changed = changed || movies[x.TMDBID]
		default:
			changed = changed || series[x.TMDBID] || tvdb[x.TVDBID]
		}
		if changed {
			due = append(due, x.ID)
		}
	}

	work := make(chan int64)
	var wg sync.WaitGroup
	for range min(metadataWorkers, len(due)) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for id := range work {
				if err := r.Refresh(ctx, id); err != nil && ctx.Err() == nil {
					r.d.Logger.Warn("refreshing a Title failed", "title", id, "err", err)
				}
			}
		}()
	}
	for _, id := range due {
		work <- id
	}
	close(work)
	wg.Wait()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	stamp, _ := json.Marshal(now.UTC().Format(time.RFC3339))
	return r.d.State.Put(ctx, refreshStateKey, stamp)
}

func set(ids []int) map[int]bool {
	m := make(map[int]bool, len(ids))
	for _, id := range ids {
		m[id] = true
	}
	return m
}

func (r *Refresher) lastRun(ctx context.Context) (time.Time, error) {
	b, ok, err := r.d.State.Get(ctx, refreshStateKey)
	if err != nil || !ok {
		return time.Time{}, err
	}
	var text string
	_ = json.Unmarshal(b, &text)
	t, _ := time.Parse(time.RFC3339, text)
	return t, nil
}
