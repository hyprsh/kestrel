package plex_test

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/adapters/plex"
	mediaserver "github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1"
	"github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1/conformance"
)

const token = "plextoken123"

type backend struct {
	mu    sync.Mutex
	calls []string // "section:path"
}

func (b *backend) Refreshed() []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	var out []string
	for _, c := range b.calls {
		out = append(out, c[strings.Index(c, ":")+1:])
	}
	return out
}

func server(t *testing.T) (*httptest.Server, *backend) {
	t.Helper()
	sections, err := os.ReadFile(filepath.Join("testdata", "sections.json"))
	if err != nil {
		t.Fatal(err)
	}
	b := &backend{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Plex-Token") != token {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch {
		case r.URL.Path == "/library/sections":
			if r.Header.Get("Accept") != "application/json" {
				w.Header().Set("Content-Type", "application/xml")
				_, _ = w.Write([]byte("<MediaContainer/>"))
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(sections)
		case strings.HasPrefix(r.URL.Path, "/library/sections/") && strings.HasSuffix(r.URL.Path, "/refresh"):
			key := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/library/sections/"), "/refresh")
			b.mu.Lock()
			b.calls = append(b.calls, key+":"+r.URL.Query().Get("path"))
			b.mu.Unlock()
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, b
}

func conn(url, tok string) plugin.Connection {
	return plugin.Connection{ID: 1, Config: map[string]any{"url": url, "token": tok}}
}

func TestPassesTheConformanceSuite(t *testing.T) {
	srv, b := server(t)
	dead := httptest.NewServer(http.NotFoundHandler())
	dead.Close()
	conformance.Run(t, conformance.Subject{
		Server:      plex.New(nil),
		Conn:        conn(srv.URL, token),
		BadAuth:     conn(srv.URL, "wrong"),
		Unreachable: conn(dead.URL, token),
		Backend:     b,
		Folder:      "/data/media/movies/Dune (2021) {tmdb-438631}",
		Unplaceable: "/elsewhere/Dune (2021)",
	})
}

func TestRefreshesTheSectionHoldingEachFolder(t *testing.T) {
	srv, b := server(t)
	err := plex.New(nil).Refresh(t.Context(), conn(srv.URL, token), []mediaserver.Change{
		{Path: "/data/media/anime/Frieren {tvdb-424536}", Kind: mediaserver.Modified},
		{Path: "/data/media/movies/Dune (2021)", Kind: mediaserver.Created},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"2:/data/media/anime/Frieren {tvdb-424536}", "1:/data/media/movies/Dune (2021)"}
	if strings.Join(b.calls, "|") != strings.Join(want, "|") {
		t.Fatalf("calls %v", b.calls)
	}
}

func TestAFolderOnlyMatchesAtADirectoryBoundary(t *testing.T) {
	srv, _ := server(t)
	err := plex.New(nil).Refresh(t.Context(), conn(srv.URL, token), []mediaserver.Change{
		{Path: "/data/media/movies-old/X (2000)", Kind: mediaserver.Created},
	})
	var pe *plugin.Error
	if err == nil || !errors.As(err, &pe) || pe.Code != plugin.CodeNotFound || !strings.Contains(pe.Message, "/data/media/movies-old/X (2000)") {
		t.Fatalf("err %v", err)
	}
}
