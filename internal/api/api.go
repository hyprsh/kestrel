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
	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/configfile"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/store"
)

// Major is the API major version: the N in /api/vN.
const Major = 1

const apiRoot = "/api/v1"

// Options configures the HTTP surface. The modules it calls come in as Deps.
type Options struct {
	Version string
	// BaseURL is the routing prefix ("" or e.g. "/kestrel", no trailing slash).
	BaseURL string
	// Store holds the API's own tables (sessions, the admin account, the API
	// key) and backs /ping and PATCH /settings' transaction.
	Store *store.Store
	// Web holds the built SPA (index.html at its root). May be empty.
	Web    fs.FS
	Logger *slog.Logger
	// Clock is the instance's time source; nil means time.Now. Tests move it.
	Clock func() time.Time
	// CheapPasswordHash hashes passwords with a tiny argon2 parameter set. Tests
	// only: the production cost takes seconds under the race detector.
	CheapPasswordHash bool
	// Stream tunes GET /stream's polling; zero means the defaults. Tests shorten it.
	Stream StreamIntervals
	// SearchTimeout bounds a manual search; zero means 30 s.
	SearchTimeout time.Duration
	// APIKey is KESTREL_API_KEY, already checked to look like a generated key.
	// When set it is the one API key: the generated one is deleted at startup and
	// POST /api-key answers 409.
	APIKey string
	// ConfigFile is the decoded Config File (KESTREL_CONFIG_FILE); nil means
	// none. Its sections are applied at startup through Declared.
	ConfigFile *configfile.File
}

// New returns the whole HTTP handler, mounted under opts.BaseURL. The modules
// behind it are the caller's to build and run.
func New(opts Options, d Deps) http.Handler {
	if opts.Logger == nil {
		opts.Logger = slog.Default()
	}
	if opts.Clock == nil {
		opts.Clock = time.Now
	}
	cost := productionCost
	if opts.CheapPasswordHash {
		cost = cheapCost
	}
	s := &server{
		opts: opts, auth: newAuth(opts.Store, opts.Clock, opts.BaseURL, cost, opts.APIKey), hub: newHub(),
		plugins: d.Plugins, profiles: d.Profiles, rootFolders: d.RootFolders, settings: d.Settings, pause: d.Pause, updates: d.Updates,
		library: d.Library, acquire: d.Acquire, requests: d.Requests, adoption: d.Adoption, cleanup: d.Cleanup,
		remover: d.Remover, imports: d.Imports, files: d.Files, jobs: d.Jobs, refresher: d.Refresher, indexers: d.Indexers,
		health: d.Health, history: d.History, scoring: d.Scoring, trash: d.Trash, keys: d.Keys, meta: d.Meta, tvdb: d.TVDB,
		bridge: d.Bridge, posters: d.Posters,
	}
	s.health.AddCheck("untrusted proxy header", s.checkUntrustedProxy)
	if err := s.auth.dropGeneratedKey(context.Background()); err != nil {
		panic("api: removing the generated API key: " + err.Error())
	}

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
		return guarded
	}
	outer := http.NewServeMux()
	outer.Handle(opts.BaseURL+"/", http.StripPrefix(opts.BaseURL, guarded))
	outer.Handle(opts.BaseURL, http.RedirectHandler(opts.BaseURL+"/", http.StatusMovedPermanently))
	return outer
}

type server struct {
	opts Options
	auth *auth
	hub  *hub

	plugins     PluginInstances
	profiles    Profiles
	rootFolders RootFolders
	settings    SettingsTx
	pause       GrabPause
	updates     Updates
	library     Library
	acquire     Acquire
	requests    Requests
	adoption    Adoption
	cleanup     Cleanup
	remover     Remover
	imports     Rescorer
	files       TitleFiles
	jobs        Jobs
	refresher   Refresher
	indexers    IndexerStatus
	health      Health
	history     History
	scoring     Scoring
	trash       Trash
	keys        ProviderKeys
	meta        metadata.Provider
	tvdb        metadata.TVDBProvider
	bridge      Bridge
	posters     Posters
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
