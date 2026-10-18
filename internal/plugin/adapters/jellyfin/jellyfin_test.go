package jellyfin_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/adapters/jellyfin"
	mediaserver "github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1"
	"github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1/conformance"
)

const token = "0123456789abcdef"

type backend struct {
	mu        sync.Mutex
	refreshed []string
	bodies    [][]byte
	headers   []string
}

func (b *backend) Refreshed() []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return append([]string{}, b.refreshed...)
}

func server(t *testing.T) (*httptest.Server, *backend) {
	t.Helper()
	info, err := os.ReadFile(filepath.Join("testdata", "system_info.json"))
	if err != nil {
		t.Fatal(err)
	}
	b := &backend{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != `MediaBrowser Token="`+token+`"` {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/System/Info":
			_, _ = w.Write(info)
		case r.Method == http.MethodPost && r.URL.Path == "/Library/Media/Updated":
			body, _ := io.ReadAll(r.Body)
			var in struct {
				Updates []struct{ Path, UpdateType string }
			}
			if err := json.Unmarshal(body, &in); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			b.mu.Lock()
			b.bodies = append(b.bodies, body)
			b.headers = append(b.headers, r.Header.Get("Content-Type"))
			for _, u := range in.Updates {
				b.refreshed = append(b.refreshed, u.Path)
			}
			b.mu.Unlock()
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, b
}

func conn(url, tok string) plugin.Connection {
	return plugin.Connection{ID: 1, Config: map[string]any{"url": url, "api_key": tok}}
}

func TestPassesTheConformanceSuite(t *testing.T) {
	srv, b := server(t)
	dead := httptest.NewServer(http.NotFoundHandler())
	dead.Close()
	conformance.Run(t, conformance.Subject{
		Server:      jellyfin.New(nil),
		Conn:        conn(srv.URL, token),
		BadAuth:     conn(srv.URL, "wrong"),
		Unreachable: conn(dead.URL, token),
		Backend:     b,
		Folder:      "/data/media/movies/Dune (2021) {tmdb-438631}",
	})
}

func TestSendsTheUpdateTypeOfEachChange(t *testing.T) {
	srv, b := server(t)
	c := jellyfin.New(nil)
	err := c.Refresh(t.Context(), conn(srv.URL, token), []mediaserver.Change{
		{Path: "/data/media/movies/A (2020)", Kind: mediaserver.Created},
		{Path: "/data/media/movies/B (2021)", Kind: mediaserver.Deleted},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := `{"Updates":[{"Path":"/data/media/movies/A (2020)","UpdateType":"Created"},{"Path":"/data/media/movies/B (2021)","UpdateType":"Deleted"}]}`
	if len(b.bodies) != 1 || string(b.bodies[0]) != want {
		t.Fatalf("body %s", b.bodies)
	}
	if b.headers[0] != "application/json" {
		t.Fatalf("content type %q", b.headers[0])
	}
}
