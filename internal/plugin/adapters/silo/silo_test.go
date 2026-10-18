package silo_test

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
	"github.com/hyprsh/kestrel/internal/plugin/adapters/silo"
	mediaserver "github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1"
	"github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1/conformance"
)

const key = "sa_0123456789abcdef"

type backend struct {
	mu        sync.Mutex
	refreshed []string
}

func (b *backend) Refreshed() []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return append([]string{}, b.refreshed...)
}

func server(t *testing.T) (*httptest.Server, *backend) {
	t.Helper()
	scan, err := os.ReadFile(filepath.Join("testdata", "scan.json"))
	if err != nil {
		t.Fatal(err)
	}
	b := &backend{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+key {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.Method != http.MethodPost || r.URL.Path != "/api/v2/scan" {
			http.NotFound(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		var in struct{ Path string }
		if json.Unmarshal(raw, &in) != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if in.Path == "/kestrel-connection-test" {
			w.WriteHeader(http.StatusBadRequest) // authenticated, but not a library path
			return
		}
		b.mu.Lock()
		b.refreshed = append(b.refreshed, in.Path)
		b.mu.Unlock()
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write(scan)
	}))
	t.Cleanup(srv.Close)
	return srv, b
}

func conn(url, k string) plugin.Connection {
	return plugin.Connection{ID: 1, Config: map[string]any{"url": url, "api_key": k}}
}

func TestPassesTheConformanceSuite(t *testing.T) {
	srv, b := server(t)
	dead := httptest.NewServer(http.NotFoundHandler())
	dead.Close()
	conformance.Run(t, conformance.Subject{
		Server:      silo.New(nil),
		Conn:        conn(srv.URL, key),
		BadAuth:     conn(srv.URL, "sa_wrong"),
		Unreachable: conn(dead.URL, key),
		Backend:     b,
		Folder:      "/data/media/movies/Dune (2021) {tmdb-438631}",
	})
}

func TestOneScanPerFolder(t *testing.T) {
	srv, b := server(t)
	err := silo.New(nil).Refresh(t.Context(), conn(srv.URL, key), []mediaserver.Change{
		{Path: "/a", Kind: mediaserver.Created}, {Path: "/b", Kind: mediaserver.Deleted},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := b.Refreshed(); len(got) != 2 || got[0] != "/a" || got[1] != "/b" {
		t.Fatalf("scans %v", got)
	}
}
