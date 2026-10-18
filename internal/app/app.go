// Package app is Kestrel's composition root: it builds every module, wires
// them together through their interfaces and hands the API the ones it calls.
// cmd/kestrel and the API tests both start a Kestrel through it, so a test
// drives the same wiring as the binary. It holds no behaviour of its own: the
// rules it wires (which provider errors count against health, which files are
// re-scored when) live in the modules and in jobs.
package app

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/api"
	"github.com/hyprsh/kestrel/internal/downloads"
	"github.com/hyprsh/kestrel/internal/health"
	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/imports"
	"github.com/hyprsh/kestrel/internal/indexers"
	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
	"github.com/hyprsh/kestrel/internal/probe"
	"github.com/hyprsh/kestrel/internal/requests"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
	"github.com/hyprsh/kestrel/internal/scoring/trashsync"
	"github.com/hyprsh/kestrel/internal/settings"
	"github.com/hyprsh/kestrel/internal/settings/rootfolders"
	"github.com/hyprsh/kestrel/internal/updates"
)

// Options configures a Kestrel. The embedded api.Options is the HTTP side: the
// version, the routing prefix, the store, the SPA, the logger, the clock and
// the test knobs of the API.
type Options struct {
	api.Options
	// Plugins is the explicit list of compiled-in plugins (cmd/kestrel fills it);
	// nil means none.
	Plugins *plugin.Registry
	// MediaRefreshDelay is how long changes to a Title folder are collected
	// before the media servers are told; 0 means 10 s. Tests shorten it.
	MediaRefreshDelay time.Duration
	// DataDir is the media mount (KESTREL_DATA_DIR); it prefills the Root folders.
	DataDir string
	// ConfigDir is the config dir (KESTREL_CONFIG_DIR); posters are cached under it.
	ConfigDir string
	// TMDBAPIKey is KESTREL_TMDB_API_KEY.
	TMDBAPIKey string
	// TVDBAPIKey is KESTREL_TVDB_API_KEY.
	TVDBAPIKey string
	// TVDB is the TheTVDB client; nil means the real one, with the key chosen by
	// the same precedence as TMDB's. Tests inject a client pointed at fixtures.
	TVDB metadata.TVDBProvider
	// Metadata is the metadata provider; nil means TMDB, with the key chosen by
	// precedence: UI override, TMDBAPIKey, embedded. Tests inject a client
	// pointed at recorded fixtures.
	Metadata metadata.Provider
	// Posters is the poster cache; nil means one under ConfigDir.
	Posters *metadata.Posters
	// Prober reads downloaded files for Imports; nil means the ffprobe on PATH.
	Prober probe.Prober
	// DiskSpace reads the free space of a path for the disk checks; nil means the
	// operating system's. Tests inject a full disk.
	DiskSpace func(path string) (health.Space, error)
	// GitHubAPI is the GitHub API root for the update check; empty means api.github.com. Tests inject a fake.
	GitHubAPI string
	// TrashSource is where TRaSH updates come from. Nil means none: no daily check,
	// and "Update from TRaSH" answers 502. cmd/kestrel passes trashsync.GitHub{}.
	TrashSource trashsync.Source
}

// App is Kestrel's wired services: the HTTP handler and the background loops.
// cmd/kestrel serves Handler and runs Jobs; tests drive Jobs pass by pass.
type App struct {
	// Handler is the whole HTTP handler, mounted under Options.BaseURL.
	Handler http.Handler
	// Jobs is the loop runner. It does nothing until Run, except that Kick and
	// Pass work at once.
	Jobs *jobs.Runner
	// Health raises and clears Needs attention rows.
	Health *health.Service
}

// NewHandler returns the whole HTTP handler, mounted under opts.BaseURL. The
// loops behind it do not run; use New and App.Jobs for that.
func NewHandler(opts Options) http.Handler { return New(opts).Handler }

// New builds the modules, wires them and returns the handler and the loops.
func New(opts Options) *App {
	if opts.Logger == nil {
		opts.Logger = slog.Default()
	}
	if opts.Clock == nil {
		opts.Clock = time.Now
	}
	if opts.Plugins == nil {
		opts.Plugins = plugin.NewRegistry()
	}
	st := opts.Store
	appSettings := settings.New(st)
	pluginInstances := instances.NewService(st, opts.Plugins)
	hist := history.New(st, opts.Clock, opts.Logger)

	embedded, err := scoring.Embedded()
	if err != nil {
		panic("app: the embedded TRaSH snapshot is invalid: " + err.Error())
	}
	live := scoring.NewHolder(embedded)
	profs := profiles.New(st, appSettings)
	profs.UseScoring(live)
	roots := rootfolders.New(appSettings, opts.DataDir)
	lib := library.New(st, opts.Clock).WithCountry(func(ctx context.Context) string {
		region, _, err := profs.Region(ctx)
		if err != nil {
			return ""
		}
		return region.Country
	})

	keys := metadata.NewKeys(appSettings, opts.TMDBAPIKey, opts.TVDBAPIKey)
	var meta metadata.Provider = opts.Metadata
	if meta == nil {
		meta = metadata.NewTMDB(metadata.TMDBOptions{Keys: keys})
	}
	var tvdb metadata.TVDBProvider = opts.TVDB
	if tvdb == nil {
		tvdb = metadata.NewTVDB(metadata.TVDBOptions{Keys: keys})
	}
	posters := opts.Posters
	if posters == nil {
		posters = metadata.NewPosters(metadata.PostersOptions{ConfigDir: opts.ConfigDir})
	}

	indexerHost := indexers.New(pluginInstances, opts.Clock)
	downloadHost := downloads.New(pluginInstances)
	healthSvc := health.New(healthDeps(opts, appSettings, roots, pluginInstances, downloadHost, hist))
	watchHealth(healthSvc, downloadHost, indexerHost)
	meta = observedMeta{Provider: meta, h: healthSvc}
	tvdb = observedTVDB{TVDBProvider: tvdb, h: healthSvc}

	acq, err := acquire.New(acquire.Deps{
		Store: st, Clock: opts.Clock, Library: lib, Profiles: profs,
		Indexers: indexerHost, Downloads: downloadHost, History: hist, Scoring: live,
	})
	if err != nil {
		panic("app: acquire cannot start: " + err.Error())
	}
	prober := opts.Prober
	if prober == nil {
		prober = probe.Default()
	}
	mediaRefresh := imports.NewRefresher(imports.RefresherDeps{
		Servers: imports.InstanceServers(pluginInstances), Health: healthSvc, Logger: opts.Logger, Delay: opts.MediaRefreshDelay,
	})
	imp, err := imports.New(imports.Deps{
		Library: lib, Renames: lib, Profiles: profs, Prober: prober, Clock: opts.Clock, Health: healthSvc,
		FolderChanged: mediaRefresh.FolderChanged, Scoring: live,
	})
	if err != nil {
		panic("app: Import cannot start: " + err.Error())
	}
	adoption, err := imports.NewAdoption(imports.AdoptionDeps{
		Store: st, Library: lib, Profiles: profs, Meta: meta, TVDB: tvdb, Prober: prober, Roots: roots, Scoring: live,
		History: hist, Clock: opts.Clock, Logger: opts.Logger, FolderChanged: mediaRefresh.FolderChanged,
		Rescore: func(ctx context.Context, titleID int64) error {
			return imp.RescoreTitles(ctx, live.Current(), []int64{titleID})
		},
	})
	if err != nil {
		panic("app: Adoption cannot start: " + err.Error())
	}
	cleanup := imports.NewCleanup(imports.CleanupDeps{Library: lib, Profiles: profs, History: hist, Clock: opts.Clock, FolderChanged: mediaRefresh.FolderChanged})
	remover := imports.NewRemover(imports.RemoverDeps{
		Library: lib, Downloads: acq, Health: healthSvc, FolderChanged: mediaRefresh.FolderChanged, Clock: opts.Clock,
	})

	var upd *updates.Service
	trash := trashsync.New(trashsync.Deps{
		Holder: live, Settings: appSettings, Source: opts.TrashSource, Health: healthSvc, Clock: opts.Clock, Logger: opts.Logger,
	})
	trashUpdates := jobs.NewTrashUpdates(jobs.TrashUpdatesDeps{
		Snapshots: trash, Holder: live, Library: lib, Rescorer: imp, Logger: opts.Logger,
		Enabled: func(ctx context.Context) bool { return upd.Enabled(ctx) },
	})
	if err := trashUpdates.Start(context.Background()); err != nil {
		panic("app: loading the stored TRaSH snapshot: " + err.Error())
	}
	reqs := requests.New(requests.Deps{
		Store: st, Clock: opts.Clock, Library: lib, Profiles: profs, RootFolders: roots,
		Meta: meta, TVDB: tvdb, Grabs: acq,
	})
	refresher := jobs.NewRefresher(jobs.RefresherDeps{
		Library: lib, Meta: meta, TVDB: tvdb, Renamer: imp, State: appSettings,
		Primary: func(ctx context.Context) (string, error) {
			region, _, err := profs.Region(ctx)
			return string(region.Primary), err
		},
		History: hist, Health: healthSvc, Clock: opts.Clock, Logger: opts.Logger,
	})
	upd = updates.New(updates.Deps{Settings: appSettings, Health: healthSvc, Version: opts.Version, APIBase: opts.GitHubAPI, Clock: opts.Clock})
	runner := jobs.Standard(jobs.Deps{
		Refresher: refresher, Updates: upd, Acquire: acq, Library: lib, History: hist, LastRun: appSettings,
		Sessions: func(ctx context.Context) error { _, err := api.PruneSessions(ctx, st, opts.Clock()); return err },
		Health:   healthSvc, Importer: imp, ImportSource: acq, Trash: trashLoop(trashUpdates, opts.TrashSource), Clock: opts.Clock, Logger: opts.Logger,
	})

	handler := api.New(opts.Options, api.Deps{
		Plugins: pluginInstances, Profiles: profs, RootFolders: roots, Settings: settingsTx{roots, profs, trash}, Updates: upd,
		Library: lib, Acquire: acq, Requests: reqs, Adoption: adoption, Cleanup: cleanup, Remover: remover, Imports: imp,
		Jobs: runner, Refresher: refresher, Indexers: indexerHost, Health: healthSvc, History: hist, Scoring: live, Trash: trashAPI{trash, trashUpdates}, Keys: keys,
		Meta: meta, TVDB: tvdb, Bridge: &metadata.Bridge{Meta: meta, TVDB: tvdb, Log: opts.Logger}, Posters: posters,
	})
	return &App{Handler: handler, Jobs: runner, Health: healthSvc}
}

// settingsTx lets PATCH /settings write the settings of several modules in one transaction.
type settingsTx struct {
	roots *rootfolders.Service
	profs *profiles.Service
	trash *trashsync.Service
}

func (s settingsTx) InTx(tx *sql.Tx) api.SettingsWriter {
	return settingsWriter{roots: s.roots.InTx(tx), profs: s.profs.InTx(tx), trash: s.trash.InTx(tx)}
}

type settingsWriter struct {
	roots *rootfolders.Service
	profs *profiles.Service
	trash *trashsync.Service
}

func (w settingsWriter) SetRootFolders(ctx context.Context, p rootfolders.Patch) (rootfolders.Folders, error) {
	return w.roots.Set(ctx, p)
}

func (w settingsWriter) SetRegion(ctx context.Context, p profiles.RegionPatch) (profiles.Region, error) {
	return w.profs.SetRegion(ctx, p)
}

func (w settingsWriter) SetKids(ctx context.Context, p profiles.KidsPatch) (profiles.KidsRule, error) {
	return w.profs.SetKids(ctx, p)
}

func (w settingsWriter) SetTrashAutoUpdate(ctx context.Context, on bool) error {
	return w.trash.SetAutoUpdate(ctx, on)
}

// trashAPI is what the API sees of TRaSH: the status and switch from trashsync,
// the updates from jobs.
type trashAPI struct {
	*trashsync.Service
	*jobs.TrashUpdates
}

// trashLoop is the daily TRaSH check, or nothing without a source.
func trashLoop(s *jobs.TrashUpdates, src trashsync.Source) jobs.TrashChecker {
	if src == nil {
		return nil
	}
	return s
}
