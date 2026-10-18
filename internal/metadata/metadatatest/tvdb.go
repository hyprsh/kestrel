package metadatatest

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

// TVDBKey is the only API key the fake TheTVDB accepts.
const TVDBKey = "fixture-tvdb-key"

// TVDBServer is the fake TheTVDB v4: login, series, aired-order episodes (two
// pages for series 81189) and remote-id search, from fixtures under testdata/.
// The fixtures follow the v4 swagger's response shapes and are written by hand.
type TVDBServer struct {
	*httptest.Server

	mu       sync.Mutex
	requests []string
	logins   int
	keys     []string
	epoch    int // bumped by ExpireTokens; the live token is "tvdb-token-<epoch+1>"
}

// NewTVDB starts the fake and stops it with the test.
func NewTVDB(t testing.TB) *TVDBServer {
	t.Helper()
	s := &TVDBServer{}
	s.helperServer(t)
	return s
}

func (s *TVDBServer) helperServer(t testing.TB) {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v4/login", func(w http.ResponseWriter, r *http.Request) {
		s.record(r)
		var body struct {
			APIKey string `json:"apikey"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		s.mu.Lock()
		s.keys = append(s.keys, body.APIKey)
		s.mu.Unlock()
		if body.APIKey != TVDBKey {
			writeFixture(w, "tvdb_unauthorized.json", http.StatusUnauthorized)
			return
		}
		s.mu.Lock()
		s.logins++
		token := s.token()
		s.mu.Unlock()
		b, _ := json.Marshal(map[string]any{"data": map[string]string{"token": token}, "status": "success"})
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(b)
	})
	authed := func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			s.record(r)
			s.mu.Lock()
			want := "Bearer " + s.token()
			s.mu.Unlock()
			if r.Header.Get("Authorization") != want {
				writeFixture(w, "tvdb_unauthorized.json", http.StatusUnauthorized)
				return
			}
			next(w, r)
		}
	}
	serve := func(name string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if _, err := fixtures.ReadFile("testdata/" + name); err != nil {
				writeFixture(w, "tvdb_not_found.json", http.StatusNotFound)
				return
			}
			writeFixture(w, name, http.StatusOK)
		}
	}
	mux.HandleFunc("GET /v4/updates", authed(func(w http.ResponseWriter, r *http.Request) {
		page := r.URL.Query().Get("page")
		if page == "" {
			page = "0"
		}
		serve("tvdb_updates_"+page+".json")(w, r)
	}))
	mux.HandleFunc("GET /v4/series/{id}", authed(func(w http.ResponseWriter, r *http.Request) {
		serve("tvdb_series_"+r.PathValue("id")+".json")(w, r)
	}))
	mux.HandleFunc("GET /v4/series/{id}/episodes/{season_type}", authed(func(w http.ResponseWriter, r *http.Request) {
		page := r.URL.Query().Get("page")
		if page == "" {
			page = "0"
		}
		serve("tvdb_episodes_"+r.PathValue("id")+"_"+page+".json")(w, r)
	}))
	mux.HandleFunc("GET /v4/search/remoteid/{remote}", authed(func(w http.ResponseWriter, r *http.Request) {
		name := "tvdb_remoteid_" + r.PathValue("remote") + ".json"
		if _, err := fixtures.ReadFile("testdata/" + name); err != nil {
			name = "tvdb_remoteid_empty.json"
		}
		writeFixture(w, name, http.StatusOK)
	}))
	s.Server = httptest.NewServer(mux)
	t.Cleanup(s.Close)
}

func (s *TVDBServer) token() string {
	return "tvdb-token-" + string(rune('1'+s.epoch))
}

// APIBase stands in for https://api4.thetvdb.com/v4.
func (s *TVDBServer) APIBase() string { return s.URL + "/v4" }

// Requests lists "METHOD path[?query]" of every request so far, oldest first.
func (s *TVDBServer) Requests() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.requests...)
}

// Logins counts successful logins.
func (s *TVDBServer) Logins() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.logins
}

// APIKeysSeen lists the apikey of every login attempt.
func (s *TVDBServer) APIKeysSeen() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.keys...)
}

// ExpireTokens makes every token issued so far be refused with 401.
func (s *TVDBServer) ExpireTokens() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.epoch++
}

func (s *TVDBServer) record(r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.requests = append(s.requests, r.Method+" "+r.URL.RequestURI())
}

func writeFixture(w http.ResponseWriter, name string, status int) {
	b, err := fixtures.ReadFile("testdata/" + name)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json;charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(b)
}
