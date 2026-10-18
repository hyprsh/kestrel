package app

import (
	"context"
	"errors"
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

// failureOf turns a plugin error into what health watches: auth or not.
func failureOf(err error) *health.Failure {
	if err == nil {
		return nil
	}
	pe := plugin.AsError(err)
	return &health.Failure{Auth: pe.Code == plugin.CodeAuth, Message: pe.Message}
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
			hf = &health.Failure{Auth: f.Code == plugin.CodeAuth, Message: f.Message}
		}
		h.ObserveIndexer(ctx, health.Ref{ID: id, Name: name}, hf)
	})
}

// ---- metadata providers ----

// metadataFailure classifies a provider error for health. Not-found and rate
// limits say nothing about the provider's health; an error that is not the
// provider's (a canceled request) is ignored too.
func metadataFailure(err error) (f *health.Failure, observe bool) {
	if err == nil {
		return nil, true
	}
	var me *metadata.Error
	if !errors.As(err, &me) {
		return nil, false
	}
	switch me.Code {
	case metadata.CodeNotFound:
		return nil, true
	case metadata.CodeRateLimited:
		return nil, false
	case metadata.CodeAuth:
		return &health.Failure{Auth: true, Message: me.Message}, true
	}
	return &health.Failure{Message: me.Message}, true
}

func observe(ctx context.Context, h *health.Service, provider string, err error) {
	if f, ok := metadataFailure(err); ok {
		h.ObserveMetadata(ctx, provider, f)
	}
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
