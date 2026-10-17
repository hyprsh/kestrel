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
	"time"

	"github.com/getkin/kin-openapi/openapi3"

	kapi "github.com/hyprsh/kestrel/api"
	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
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
}

// NewHandler returns the whole HTTP handler, mounted under opts.BaseURL.
func NewHandler(opts Options) http.Handler {
	if opts.Logger == nil {
		opts.Logger = slog.Default()
	}
	if opts.Clock == nil {
		opts.Clock = time.Now
	}
	if opts.Plugins == nil {
		opts.Plugins = plugin.NewRegistry()
	}
	s := &server{
		opts:    opts,
		auth:    newAuth(opts.Store, opts.Clock, opts.BaseURL),
		plugins: instances.NewService(opts.Store, opts.Plugins),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /ping", s.ping)

	strict := oapi.NewStrictHandlerWithOptions(s, nil, oapi.StrictHTTPServerOptions{
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
	opts    Options
	auth    *auth
	plugins *instances.Service
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
	body, err := func() ([]byte, error) {
		doc, err := openapi3.NewLoader().LoadFromData(kapi.Spec)
		if err != nil {
			return nil, err
		}
		doc.Servers = openapi3.Servers{{URL: s.opts.BaseURL + apiRoot}}
		return doc.MarshalJSON()
	}()
	if err != nil {
		panic("api: embedded openapi.yaml is invalid: " + err.Error())
	}
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}
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
