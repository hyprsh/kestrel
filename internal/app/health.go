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
	mediaserver "github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1"
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
func healthDeps(opts Options, appSettings *settings.Settings, roots *rootfolders.Service, plugins *instances.Service, dl *downloads.Service, hist *history.Service, probes map[string]func(context.Context) error) health.Deps {
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
			MediaServers: func(ctx context.Context) ([]health.Ref, error) {
				enabled, err := plugins.Enabled(ctx, mediaserver.Contract.ID)
				refs := make([]health.Ref, len(enabled))
				for i, e := range enabled {
					refs[i] = health.Ref{ID: e.ID, Name: e.Name}
				}
				return refs, err
			},
			TestMediaServer: func(ctx context.Context, ref health.Ref) *health.Failure {
				return testInstance(ctx, plugins, opts.Clock, ref.ID)
			},
			MetadataProbes: probes,
		},
	}
}

// checkTimeout bounds one scheduled Test of a media server.
const checkTimeout = 30 * time.Second

// testInstance runs the plugin's Test on a stored instance, records the outcome
// as the instance's last check and returns what health watches of it.
func testInstance(ctx context.Context, plugins *instances.Service, clock func() time.Time, id int64) *health.Failure {
	inst, err := plugins.Get(ctx, id)
	if err != nil {
		return nil // gone since the list was read; the next check retires its row
	}
	p, _, ok := plugins.Registry().Lookup(inst.PluginID)
	if !ok {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, checkTimeout)
	defer cancel()
	_, err = p.Test(ctx, inst.Connection())
	if err != nil && ctx.Err() != nil && errors.Is(err, ctx.Err()) {
		err = plugin.Errorf(plugin.CodeUnavailable, "the plugin did not answer in time")
	}
	record(context.WithoutCancel(ctx), plugins, clock, id, err)
	return failureOf(err)
}

// record stores the outcome of a call to an instance as its last check. A
// failure to store it is not worth failing the call for.
func record(ctx context.Context, plugins *instances.Service, clock func() time.Time, id int64, err error) {
	_ = plugins.RecordCheck(ctx, id, clock(), err)
}

// watchHealth lets health hear how calls to the download client, the indexers
// and the metadata providers go, and keeps each instance's last check.
func watchHealth(h *health.Service, dl *downloads.Service, ix *indexers.Service, plugins *instances.Service, clock func() time.Time) {
	dl.SetObserver(func(ctx context.Context, id int64, name string, err error) {
		record(ctx, plugins, clock, id, err)
		h.ObserveDownloadClient(ctx, health.Ref{ID: id, Name: name}, failureOf(err))
	})
	ix.SetObserver(func(ctx context.Context, id int64, name string, f *indexers.Failure) {
		var hf *health.Failure
		var err error
		if f != nil {
			hf = failure(f.Code, f.Message)
			err = plugin.Errorf(f.Code, "%s", f.Message)
		}
		record(ctx, plugins, clock, id, err)
		h.ObserveIndexer(ctx, health.Ref{ID: id, Name: name}, hf)
	})
}

// ---- probes ----

// A probe is one cheap lookup of a title that has always existed. It goes
// through the observed provider, so health hears the outcome as for any call.
const (
	probeTMDBMovie = 603   // The Matrix
	probeTVDBShow  = 81189 // Breaking Bad
)

// metadataProbes makes a probe of each provider that has a key. A provider with
// none is not in use, and a call would only raise a row for it.
func metadataProbes(keys metadata.Keys, meta func() metadata.Provider, tvdb func() metadata.TVDBProvider) map[string]func(context.Context) error {
	return map[string]func(context.Context) error{
		"TMDB": func(ctx context.Context) error {
			if k, err := keys.TMDB(ctx); err != nil || k == "" {
				return err
			}
			_, err := meta().Movie(ctx, probeTMDBMovie)
			return err
		},
		"TheTVDB": func(ctx context.Context) error {
			if k, err := keys.TVDB(ctx); err != nil || k == "" {
				return err
			}
			_, err := tvdb().Series(ctx, probeTVDBShow)
			return err
		},
	}
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
