package app

import (
	"context"
	"time"

	"github.com/hyprsh/kestrel/internal/downloads"
	"github.com/hyprsh/kestrel/internal/health"
	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/indexers"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/plugin"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
	"github.com/hyprsh/kestrel/internal/settings"
	"github.com/hyprsh/kestrel/internal/settings/rootfolders"
)

// failure is what health watches of a plugin failure: auth or not.
func failure(code plugin.Code, message string) *health.Failure {
	return &health.Failure{Auth: code == plugin.CodeAuth, Message: message}
}

// failureOf turns a plugin error into what health watches.
func failureOf(err error) *health.Failure {
	if err == nil {
		return nil
	}
	pe := plugin.AsError(err)
	return failure(pe.Code, pe.Message)
}

// healthDeps wires the health module to this instance's services. Everything
// that raises a row on a timer or on observation hangs off here.
func healthDeps(opts Options, appSettings *settings.Settings, roots *rootfolders.Service, plugins *instances.Service, dl *downloads.Service, hist *history.Service) health.Deps {
	return health.Deps{
		Store: opts.Store, Clock: opts.Clock, History: hist, Logger: opts.Logger,
		Checks: health.ChecksDeps{
			SetupDone: func(ctx context.Context) bool {
				_, done, err := appSettings.Get(ctx, settings.SetupCompleted)
				return err == nil && done
			},
			RootFolders: func(ctx context.Context) ([]string, error) {
				f, _, err := roots.Get(ctx)
				return append(append([]string{}, f.Movies...), f.Series...), err
			},
			DataDir: opts.DataDir,
			Disk:    opts.DiskSpace,
			EnabledIndexers: func(ctx context.Context) ([]health.Ref, error) {
				enabled, err := plugins.Enabled(ctx, indexer.Contract.ID)
				refs := make([]health.Ref, len(enabled))
				for i, e := range enabled {
					refs[i] = health.Ref{ID: e.ID, Name: e.Name}
				}
				return refs, err
			},
			Ping: func(ctx context.Context) error {
				_, err := dl.Ping(ctx)
				return err
			},
		},
	}
}

// watchHealth lets health hear how calls to the download client, the indexers
// and the metadata providers go.
func watchHealth(h *health.Service, dl *downloads.Service, ix *indexers.Service) {
	dl.SetObserver(func(ctx context.Context, id int64, name string, err error) {
		h.ObserveDownloadClient(ctx, health.Ref{ID: id, Name: name}, failureOf(err))
	})
	ix.SetObserver(func(ctx context.Context, id int64, name string, f *indexers.Failure) {
		var hf *health.Failure
		if f != nil {
			hf = failure(f.Code, f.Message)
		}
		h.ObserveIndexer(ctx, health.Ref{ID: id, Name: name}, hf)
	})
}

// ---- metadata providers ----

// observe tells health how a metadata call went; metadata.StandingOf decides
// which calls count.
func observe(ctx context.Context, h *health.Service, provider string, err error) {
	st := metadata.StandingOf(err)
	if !st.Counts {
		return
	}
	var f *health.Failure
	if st.Failing {
		f = &health.Failure{Auth: st.Auth, Message: st.Message}
	}
	h.ObserveMetadata(ctx, provider, f)
}

type observedMeta struct {
	metadata.Provider
	h *health.Service
}

func (o observedMeta) Search(ctx context.Context, q string) ([]metadata.SearchResult, error) {
	r, err := o.Provider.Search(ctx, q)
	observe(ctx, o.h, "TMDB", err)
	return r, err
}

func (o observedMeta) Movie(ctx context.Context, id int) (metadata.MovieDetails, error) {
	r, err := o.Provider.Movie(ctx, id)
	observe(ctx, o.h, "TMDB", err)
	return r, err
}

func (o observedMeta) Series(ctx context.Context, id int) (metadata.SeriesDetails, error) {
	r, err := o.Provider.Series(ctx, id)
	observe(ctx, o.h, "TMDB", err)
	return r, err
}

func (o observedMeta) SeriesExternalIDs(ctx context.Context, id int) (metadata.ExternalIDs, error) {
	r, err := o.Provider.SeriesExternalIDs(ctx, id)
	observe(ctx, o.h, "TMDB", err)
	return r, err
}

type observedTVDB struct {
	metadata.TVDBProvider
	h *health.Service
}

func (o observedTVDB) Series(ctx context.Context, id int) (metadata.TVDBSeries, error) {
	r, err := o.TVDBProvider.Series(ctx, id)
	observe(ctx, o.h, "TheTVDB", err)
	return r, err
}

func (o observedTVDB) EpisodeNames(ctx context.Context, id int, lang string) (map[int]string, error) {
	r, err := o.TVDBProvider.EpisodeNames(ctx, id, lang)
	observe(ctx, o.h, "TheTVDB", err)
	return r, err
}

func (o observedTVDB) SeriesByIMDb(ctx context.Context, imdbID string) (int, bool, error) {
	id, ok, err := o.TVDBProvider.SeriesByIMDb(ctx, imdbID)
	observe(ctx, o.h, "TheTVDB", err)
	return id, ok, err
}

func (o observedMeta) Changes(ctx context.Context, kind metadata.Kind, since time.Time) ([]int, error) {
	r, err := o.Provider.Changes(ctx, kind, since)
	observe(ctx, o.h, "TMDB", err)
	return r, err
}

func (o observedTVDB) Updates(ctx context.Context, since time.Time) ([]int, error) {
	r, err := o.TVDBProvider.Updates(ctx, since)
	observe(ctx, o.h, "TheTVDB", err)
	return r, err
}
