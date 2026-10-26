// Package plextvtest is a fake plex.tv and Plex server for tests: one httptest
// server that answers the PIN, account and shared-users calls of plex.tv and
// the Plex server's /identity and library sections. Tests set up who exists
// and who is shared with, and authorise PINs as the Plex sign-in page would.
package plextvtest

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/hyprsh/kestrel/internal/plextv"
)

// Machine is the fake Plex server's machine identifier.
const Machine = "machine-of-the-household"

// OwnerToken is the owner's token, the one a Plex instance holds.
const OwnerToken = "owner-token"

// Call is a request the fake answered.
type Call struct {
	Method, Path string
	ClientID     string
	Product      string
	Version      string
	Token        string
}

// Server is the fake. Its URL is both plex.tv's and the Plex server's.
type Server struct {
	*httptest.Server

	mu       sync.Mutex
	accounts map[string]plextv.Account // by token
	users    []plextv.SharedUser
	pins     map[int64]*pin
	nextPin  int64
	down     bool
	calls    []Call
	machine  string
}

type pin struct {
	code    string
	token   string
	expired bool
}

// Owner is the account behind OwnerToken.
var Owner = plextv.Account{ID: 1, UUID: "uuid-owner", Username: "owner", Title: "owner"}

// New starts the fake and stops it with the test. The owner exists, and the
// household shares with nobody yet.
func New(t testing.TB) *Server {
	t.Helper()
	s := &Server{accounts: map[string]plextv.Account{OwnerToken: Owner}, pins: map[int64]*pin{}, nextPin: 100, machine: Machine}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v2/pins", s.handle(func(w http.ResponseWriter, r *http.Request) {
		s.nextPin++
		p := &pin{code: "code" + strconv.FormatInt(s.nextPin, 10) + "abcdefghijklmnopqr"}
		s.pins[s.nextPin] = p
		writeJSON(w, map[string]any{"id": s.nextPin, "code": p.code, "authToken": nil})
	}))
	mux.HandleFunc("GET /api/v2/pins/{id}", s.handle(func(w http.ResponseWriter, r *http.Request) {
		id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
		p := s.pins[id]
		if p == nil || p.expired || p.code != r.URL.Query().Get("code") {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"errors":[{"code":1020,"message":"Code not found or expired"}]}`))
			return
		}
		var token any
		if p.token != "" {
			token = p.token
		}
		writeJSON(w, map[string]any{"id": id, "code": p.code, "authToken": token})
	}))
	mux.HandleFunc("GET /api/v2/user", s.handle(func(w http.ResponseWriter, r *http.Request) {
		a, ok := s.accounts[r.Header.Get("X-Plex-Token")]
		if !ok {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		writeJSON(w, map[string]any{"id": a.ID, "uuid": a.UUID, "username": a.Username, "title": a.Title, "thumb": a.Thumb})
	}))
	mux.HandleFunc("GET /api/users", s.handle(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Plex-Token") != OwnerToken {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var b strings.Builder
		b.WriteString(`<?xml version="1.0" encoding="UTF-8"?><MediaContainer friendlyName="myPlex" size="` + strconv.Itoa(len(s.users)) + `">`)
		for _, u := range s.users {
			home := "0"
			if u.Home {
				home = "1"
			}
			fmt.Fprintf(&b, `<User id="%d" title="%s" username="%s" home="%s" restricted="0">`, u.ID, xmlEscape(u.Title), xmlEscape(u.Username), home)
			for _, m := range u.Servers {
				fmt.Fprintf(&b, `<Server id="1" name="Plex" machineIdentifier="%s" numLibraries="3"/>`, xmlEscape(m))
			}
			b.WriteString(`</User>`)
		}
		b.WriteString(`</MediaContainer>`)
		w.Header().Set("Content-Type", "application/xml")
		_, _ = w.Write([]byte(b.String()))
	}))
	mux.HandleFunc("GET /identity", s.handle(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"MediaContainer": map[string]any{"size": 0, "claimed": true, "machineIdentifier": s.machine, "version": "1.41.0"}})
	}))
	mux.HandleFunc("GET /library/sections", s.handle(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Plex-Token") != OwnerToken {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		writeJSON(w, map[string]any{"MediaContainer": map[string]any{"size": 0, "Directory": []any{}}})
	}))
	s.Server = httptest.NewServer(mux)
	t.Cleanup(s.Server.Close)
	return s
}

// xmlEscape escapes text for a double-quoted attribute.
func xmlEscape(v string) string {
	var b strings.Builder
	_ = xml.EscapeText(&b, []byte(v))
	return b.String()
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

// handle records the call and answers 503 while the fake is down.
func (s *Server) handle(f http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.calls = append(s.calls, Call{
			Method: r.Method, Path: r.URL.Path, ClientID: r.Header.Get("X-Plex-Client-Identifier"),
			Product: r.Header.Get("X-Plex-Product"), Version: r.Header.Get("X-Plex-Version"), Token: r.Header.Get("X-Plex-Token"),
		})
		if s.down {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		f(w, r)
	}
}

// AddAccount creates a plex.tv account that signs in with token.
func (s *Server) AddAccount(token string, a plextv.Account) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.accounts[token] = a
}

// Share lists u among the owner's friends and Plex Home members, replacing an earlier one with its id.
func (s *Server) Share(u plextv.SharedUser) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.unshare(u.ID)
	s.users = append(s.users, u)
}

// Unshare removes the user from the owner's list.
func (s *Server) Unshare(id int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.unshare(id)
}

func (s *Server) unshare(id int64) {
	kept := s.users[:0:0]
	for _, u := range s.users {
		if u.ID != id {
			kept = append(kept, u)
		}
	}
	s.users = kept
}

// Authorise is the account behind token authorising the PIN with code, as the Plex sign-in page does.
func (s *Server) Authorise(code, token string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, p := range s.pins {
		if p.code == code {
			p.token = token
		}
	}
}

// ExpireAll makes every PIN unknown, as plex.tv does after 15 minutes.
func (s *Server) ExpireAll() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, p := range s.pins {
		p.expired = true
	}
}

// SetDown makes every call answer 503, as an outage does.
func (s *Server) SetDown(down bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.down = down
}

// Calls lists the calls answered so far.
func (s *Server) Calls() []Call {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Call(nil), s.calls...)
}
