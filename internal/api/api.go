// Package api is Kestrel's HTTP surface: the spec-first REST API under
// {base}/api/v1, the published OpenAPI document and its docs page, the
// unauthenticated {base}/ping, and the embedded SPA for everything else.
//
// It is a thin adapter. Generated strict-server handlers call module
// interfaces and hold no domain rules.
package api

import (
	"context"
	"io/fs"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/getkin/kin-openapi/openapi3"

	kapi "github.com/hyprsh/kestrel/api"
	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/downloads"
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
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
	"github.com/hyprsh/kestrel/internal/settings"
	"github.com/hyprsh/kestrel/internal/settings/rootfolders"
	"github.com/hyprsh/kestrel/internal/store"
)

// Major is the API major version: the N in /api/vN.
const Major = 1

const apiRoot = "/api/v1"

// Options configures NewHandler.
type Options struct {
	Version string
	// BaseURL is the routing prefix ("" or e.g. "/kestrel", no trailing slash).
	BaseURL string
	Store   *store.Store
	// Web holds the built SPA (index.html at its root). May be empty.
	Web    fs.FS
	Logger *slog.Logger
	// Clock is the instance's time source; nil means time.Now. Tests move it.
	Clock func() time.Time
	// Plugins is the explicit list of compiled-in plugins (cmd/kestrel fills it);
	// nil means none.
	Plugins *plugin.Registry
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
	// CheapPasswordHash hashes passwords with a tiny argon2 parameter set. Tests
	// only: the production cost takes seconds under the race detector.
	CheapPasswordHash bool
	// Stream tunes GET /stream's polling; zero means the defaults. Tests shorten it.
	Stream StreamIntervals
	// SearchTimeout bounds a manual search; zero means 30 s.
	SearchTimeout time.Duration
}

// App is Kestrel's wired services: the HTTP handler and the background loops.
// cmd/kestrel serves Handler and runs Jobs; tests drive Jobs pass by pass.
type App struct {
	// Handler is the whole HTTP handler, mounted under Options.BaseURL.
	Handler http.Handler
	// Jobs is the loop runner. It does nothing until Run, except that Kick and
	// Pass work at once.
	Jobs *jobs.Runner
}

// NewHandler returns the whole HTTP handler, mounted under opts.BaseURL. The
// loops behind it do not run; use New and App.Jobs for that.
func NewHandler(opts Options) http.Handler { return New(opts).Handler }

// New wires the services behind the API and the loops that follow their state.
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
	cost := productionCost
	if opts.CheapPasswordHash {
		cost = cheapCost
	}
	s := &server{
		opts:    opts,
		auth:    newAuth(opts.Store, opts.Clock, opts.BaseURL, cost),
		plugins: instances.NewService(opts.Store, opts.Plugins),
	}
	s.history = history.New(opts.Store, opts.Clock, opts.Logger)
	s.hub = newHub()
	appSettings := settings.New(opts.Store)
	s.profiles = profiles.New(opts.Store, appSettings)
	s.rootFolders = rootfolders.New(appSettings, opts.DataDir)
	s.library = library.New(opts.Store, opts.Clock)
	s.meta = opts.Metadata
	if s.meta == nil {
		s.meta = metadata.NewTMDB(metadata.TMDBOptions{Keys: metadata.NewKeys(appSettings, opts.TMDBAPIKey, opts.TVDBAPIKey)})
	}
	s.tvdb = opts.TVDB
	if s.tvdb == nil {
		s.tvdb = metadata.NewTVDB(metadata.TVDBOptions{Keys: metadata.NewKeys(appSettings, opts.TMDBAPIKey, opts.TVDBAPIKey)})
	}
	s.posters = opts.Posters
	if s.posters == nil {
		s.posters = metadata.NewPosters(metadata.PostersOptions{ConfigDir: opts.ConfigDir})
	}

	acq, err := acquire.New(acquire.Deps{
		Store: opts.Store, Clock: opts.Clock, Library: s.library, Profiles: s.profiles,
		Indexers: indexers.New(s.plugins, opts.Clock), Downloads: downloads.New(s.plugins), History: s.history,
	})
	if err != nil {
		panic("api: the embedded TRaSH snapshot is invalid: " + err.Error())
	}
	s.acquire = acq
	prober := opts.Prober
	if prober == nil {
		prober = probe.Default()
	}
	imp, err := imports.New(imports.Deps{Library: s.library, Profiles: s.profiles, Prober: prober, Clock: opts.Clock})
	if err != nil {
		panic("api: the embedded TRaSH snapshot is invalid: " + err.Error())
	}
	s.requests = requests.New(requests.Deps{
		Store: opts.Store, Clock: opts.Clock, Library: s.library, Profiles: s.profiles, RootFolders: s.rootFolders,
		Meta: s.meta, TVDB: s.tvdb, Grabs: acq,
	})
	s.jobs = jobs.Standard(jobs.Deps{Acquire: acq, Library: s.library, History: s.history, Importer: imp, ImportSource: acq, Clock: opts.Clock, Logger: opts.Logger})

	mux := http.NewServeMux()
	mux.HandleFunc("GET /ping", s.ping)

	strict := oapi.NewStrictHandlerWithOptions(s, []oapi.StrictMiddlewareFunc{s.emitHints}, oapi.StrictHTTPServerOptions{
		RequestErrorHandlerFunc: func(w http.ResponseWriter, _ *http.Request, err error) {
			writeProblem(w, http.StatusBadRequest, "validation", err.Error())
		},
		ResponseErrorHandlerFunc: func(w http.ResponseWriter, _ *http.Request, err error) {
			if p, ok := asProblem(err); ok {
				p.write(w)
				return
			}
			opts.Logger.Error("api handler failed", "err", err)
			writeProblem(w, http.StatusInternalServerError, "internal", "internal error")
		},
	})
	oapi.HandlerWithOptions(strict, oapi.StdHTTPServerOptions{BaseURL: apiRoot, BaseRouter: mux})
	mux.HandleFunc("GET "+apiRoot+"/openapi.json", s.specJSON())
	mux.HandleFunc("GET /api/docs", docsPage)
	mux.HandleFunc("/api/", func(w http.ResponseWriter, _ *http.Request) {
		writeProblem(w, http.StatusNotFound, "not_found", "no such API endpoint")
	})
	mux.Handle("/", newSPA(opts.Web, opts.BaseURL))

	guarded := s.auth.guard(mux)
	if opts.BaseURL == "" {
		return &App{Handler: guarded, Jobs: s.jobs}
	}
	outer := http.NewServeMux()
	outer.Handle(opts.BaseURL+"/", http.StripPrefix(opts.BaseURL, guarded))
	outer.Handle(opts.BaseURL, http.RedirectHandler(opts.BaseURL+"/", http.StatusMovedPermanently))
	return &App{Handler: outer, Jobs: s.jobs}
}

type server struct {
	opts        Options
	auth        *auth
	plugins     *instances.Service
	profiles    *profiles.Service
	rootFolders *rootfolders.Service
	library     *library.Service
	acquire     *acquire.Service
	requests    *requests.Service
	jobs        *jobs.Runner
	history     *history.Service
	hub         *hub
	meta        metadata.Provider
	tvdb        metadata.TVDBProvider
	posters     *metadata.Posters
}

var _ oapi.StrictServerInterface = (*server)(nil)

func (s *server) GetSystem(_ context.Context, _ oapi.GetSystemRequestObject) (oapi.GetSystemResponseObject, error) {
	return oapi.GetSystem200JSONResponse{Version: s.opts.Version, ApiMajor: Major, BaseUrl: s.opts.BaseURL}, nil
}

// ping backs the Docker HEALTHCHECK: 200 with no body while the database answers.
func (s *server) ping(w http.ResponseWriter, r *http.Request) {
	if s.opts.Store != nil {
		if err := s.opts.Store.Read().PingContext(r.Context()); err != nil {
			s.opts.Logger.Error("ping: database unreachable", "err", err)
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
	}
	w.WriteHeader(http.StatusOK)
}

// specJSON serves openapi.yaml as JSON, with the server URL set to this
// instance's prefixed API root so the docs page's "try it" works.
func (s *server) specJSON() http.HandlerFunc {
	body, err := specBody(s.opts.BaseURL + apiRoot)
	if err != nil {
		panic("api: embedded openapi.yaml is invalid: " + err.Error())
	}
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}
}

var (
	specMu   sync.Mutex
	specOnce sync.Once
	specDoc  *openapi3.T
	specErr  error
)

// specBody is openapi.yaml as JSON with the given server URL. The YAML is
// parsed once per process, however many instances start (tests start many).
func specBody(server string) ([]byte, error) {
	specOnce.Do(func() { specDoc, specErr = openapi3.NewLoader().LoadFromData(kapi.Spec) })
	if specErr != nil {
		return nil, specErr
	}
	specMu.Lock()
	defer specMu.Unlock()
	specDoc.Servers = openapi3.Servers{{URL: server}}
	return specDoc.MarshalJSON()
}

// docsPage renders Scalar over the published spec. The spec URL is relative,
// so it works under any base URL.
func docsPage(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Kestrel API</title>
  </head>
  <body>
    <script id="api-reference" data-url="v1/openapi.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>
`))
}
