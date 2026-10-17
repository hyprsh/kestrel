// Package metadatatest is a fake TMDB for tests: an httptest server that
// answers the few endpoints Kestrel calls from fixtures under testdata/. The
// fixtures follow TMDB's v3 response shapes; they are written by hand because
// no project key exists to record them with.
package metadatatest

import (
	"embed"
	"net/http"
	"net/http/httptest"
	"path"
	"strings"
	"sync"
	"testing"
)

//go:embed testdata/*
var fixtures embed.FS

// Key is the only API key the fake accepts.
const Key = "fixture-key"

// Server is the fake TMDB.
type Server struct {
	*httptest.Server

	mu       sync.Mutex
	requests []string
	keys     []string
}

// New starts the fake and stops it with the test.
func New(t testing.TB) *Server {
	t.Helper()
	s := &Server{}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /3/search/multi", s.handle(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(strings.ToLower(r.URL.Query().Get("query")), "paddington") {
			s.file(w, "search_multi.json", http.StatusOK)
			return
		}
		_, _ = w.Write([]byte(`{"page":1,"results":[],"total_pages":0,"total_results":0}`))
	}))
	mux.HandleFunc("GET /3/movie/{id}", s.handle(func(w http.ResponseWriter, r *http.Request) {
		name := "movie_" + r.PathValue("id") + ".json"
		if _, err := fixtures.ReadFile("testdata/" + name); err != nil {
			s.file(w, "not_found.json", http.StatusNotFound)
			return
		}
		s.file(w, name, http.StatusOK)
	}))
	mux.HandleFunc("GET /t/p/{size}/{file}", func(w http.ResponseWriter, r *http.Request) {
		s.record(r)
		w.Header().Set("Content-Type", "image/jpeg")
		b, _ := fixtures.ReadFile("testdata/poster.jpg")
		_, _ = w.Write(b)
	})
	s.Server = httptest.NewServer(mux)
	t.Cleanup(s.Close)
	return s
}

// APIBase is the base URL to give the client, the stand-in for
// https://api.themoviedb.org/3.
func (s *Server) APIBase() string { return s.URL + "/3" }

// ImageBase stands in for https://image.tmdb.org/t/p.
func (s *Server) ImageBase() string { return s.URL + "/t/p" }

// Requests lists "path?query" of every request so far, oldest first.
func (s *Server) Requests() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.requests...)
}

// KeysSeen lists the api_key of every API request so far.
func (s *Server) KeysSeen() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.keys...)
}

func (s *Server) record(r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.requests = append(s.requests, r.URL.RequestURI())
}

func (s *Server) handle(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s.record(r)
		key := r.URL.Query().Get("api_key")
		s.mu.Lock()
		s.keys = append(s.keys, key)
		s.mu.Unlock()
		if key != Key {
			s.file(w, "unauthorized.json", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

func (s *Server) file(w http.ResponseWriter, name string, status int) {
	b, err := fixtures.ReadFile(path.Join("testdata", name))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json;charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(b)
}
