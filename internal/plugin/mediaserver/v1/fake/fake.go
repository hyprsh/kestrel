// Package fake is the in-memory media_server.v1 server. Host tests use it in
// place of Plex, Jellyfin or Silo; it passes the same conformance suite.
package fake

import (
	"context"
	"strings"
	"sync"

	"github.com/hyprsh/kestrel/internal/plugin"
	mediaserver "github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1"
)

// ID is the fake's plugin id.
const ID = "fake_media_server"

// Server is an in-memory media server. Use New.
type Server struct {
	token string

	mu        sync.Mutex
	refreshed []string
	fail      error
}

var _ mediaserver.Server = (*Server)(nil)

// New returns a server that accepts connections whose "token" is token.
func New(token string) *Server { return &Server{token: token} }

// Conn returns a working connection. Set Config["unreachable"] on a copy to
// simulate a server that is down.
func (s *Server) Conn(id int64) plugin.Connection {
	return plugin.Connection{ID: id, Config: map[string]any{"token": s.token}}
}

// FailWith makes every following Refresh return err; nil stops it.
func (s *Server) FailWith(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.fail = err
}

// Refreshed lists the folders refreshed so far (conformance.Backend).
func (s *Server) Refreshed() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string{}, s.refreshed...)
}

func (*Server) Describe() plugin.Manifest {
	return plugin.Manifest{
		ID: ID, Name: "In-memory fake", Contract: mediaserver.Contract.ID, Version: "1",
		Fields: []plugin.Field{{Key: "token", Label: "Token", Type: plugin.FieldSecret}},
	}
}

func (s *Server) check(conn plugin.Connection) error {
	if conn.Bool("unreachable") {
		return plugin.Errorf(plugin.CodeUnavailable, "the fake is down")
	}
	if conn.String("token") != s.token {
		return plugin.Errorf(plugin.CodeAuth, "token rejected")
	}
	return nil
}

func (s *Server) Test(_ context.Context, conn plugin.Connection) (plugin.TestResult, error) {
	if err := s.check(conn); err != nil {
		return plugin.TestResult{}, err
	}
	return plugin.TestResult{Message: "fake media server"}, nil
}

func (*Server) ListOptions(context.Context, plugin.Connection, string) ([]plugin.Option, error) {
	return nil, plugin.Errorf(plugin.CodeInvalid, "no live options")
}

// Unplaceable is the folder prefix the fake treats as lying in no library.
const Unplaceable = "/nowhere"

func (s *Server) Refresh(_ context.Context, conn plugin.Connection, changes []mediaserver.Change) error {
	if err := s.check(conn); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.fail != nil {
		return s.fail
	}
	var bad *plugin.Error
	for _, c := range changes {
		if strings.HasPrefix(c.Path, Unplaceable) {
			bad = plugin.Errorf(plugin.CodeNotFound, "%s is in no library", c.Path)
			continue
		}
		s.refreshed = append(s.refreshed, c.Path)
	}
	if bad != nil {
		return bad
	}
	return nil
}
