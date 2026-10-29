package silo_test

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/adapters/silo"
)

type seen struct {
	mu      sync.Mutex
	history []string // raw queries of the history reads
	items   []string // catalog item ids asked for
}

// historyServer serves the fixture history in two pages by cursor, and the
// catalog items the plays and the show lookups need.
func historyServer(t *testing.T) (*httptest.Server, *seen) {
	t.Helper()
	read := func(name string) string {
		b, err := os.ReadFile(filepath.Join("testdata", name))
		if err != nil {
			t.Fatal(err)
		}
		return string(b)
	}
	s := &seen{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+key {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/api/v2/admin/playback-history":
			s.mu.Lock()
			s.history = append(s.history, r.URL.RawQuery)
			s.mu.Unlock()
			if r.URL.Query().Get("cursor") == "c2" {
				_, _ = w.Write([]byte(read("history_page2.json")))
				return
			}
			_, _ = w.Write([]byte(read("history_page1.json")))
		case strings.HasPrefix(r.URL.Path, "/api/v2/catalog/items/"):
			id := strings.TrimPrefix(r.URL.Path, "/api/v2/catalog/items/")
			s.mu.Lock()
			s.items = append(s.items, id)
			s.mu.Unlock()
			switch id {
			case "show-1":
				_, _ = w.Write([]byte(read("show.json")))
			case "ep-2", "ep-3":
				_, _ = w.Write([]byte(strings.ReplaceAll(read("episode.json"), "EPID", id)))
			default:
				http.NotFound(w, r)
			}
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, s
}

func TestPlaysPagesByCursorAndListsEpisodePlaysOldestFirst(t *testing.T) {
	srv, s := historyServer(t)
	since := time.Date(2025, 10, 1, 0, 0, 0, 0, time.UTC)
	got, err := silo.New(nil).Plays(t.Context(), conn(srv.URL, key), since)
	if err != nil {
		t.Fatal(err)
	}
	// The movie, the unattributed episode and the deleted episode are left out.
	if len(got.Items) != 3 {
		t.Fatalf("plays = %+v, want the three episode plays of the show", got.Items)
	}
	for i, want := range []struct {
		ep int
		at string
	}{{2, "2025-10-05T10:45:00Z"}, {2, "2025-10-08T10:45:00Z"}, {3, "2025-10-09T10:45:00Z"}} {
		p := got.Items[i]
		if p.ShowKey != "show-1" || p.Season != 1 || p.Episode != want.ep || p.ViewedAt.Format(time.RFC3339) != want.at {
			t.Errorf("play %d = %+v, want episode %d at %s", i, p, want.ep, want.at)
		}
	}
	if want := time.Date(2025, 10, 9, 10, 45, 0, 0, time.UTC); !got.Through.Equal(want) {
		t.Errorf("through = %v, want the newest entry's time %v", got.Through, want)
	}
	if len(s.history) != 2 {
		t.Fatalf("history reads = %v, want two pages", s.history)
	}
	for _, q := range s.history {
		for _, want := range []string{"limit=200", "completed=true", "ended_after=2025-10-01T00%3A00%3A00Z"} {
			if !strings.Contains(q, want) {
				t.Errorf("read %q lacks %s", q, want)
			}
		}
	}
	if strings.Contains(s.history[0], "cursor") || !strings.Contains(s.history[1], "cursor=c2") {
		t.Errorf("reads %v, want no cursor first and c2 second", s.history)
	}
	// Each distinct episode is looked up once: ep-3, ep-2 and ep-gone.
	if len(s.items) != 3 {
		t.Errorf("catalog lookups = %v, want one per distinct episode", s.items)
	}
}

func TestPlaysFromTheZeroTimeSendsNoLowerBound(t *testing.T) {
	srv, s := historyServer(t)
	if _, err := silo.New(nil).Plays(t.Context(), conn(srv.URL, key), time.Time{}); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(s.history[0], "ended_after") {
		t.Errorf("first read asked %q, want no lower bound", s.history[0])
	}
}

func TestPlaysRejectsABadKey(t *testing.T) {
	srv, _ := historyServer(t)
	_, err := silo.New(nil).Plays(t.Context(), conn(srv.URL, "sa_wrong"), time.Time{})
	var pe *plugin.Error
	if !errors.As(err, &pe) || pe.Code != plugin.CodeAuth {
		t.Fatalf("err = %v, want an auth error", err)
	}
}

func TestShowGuidsNamesTheExternalIds(t *testing.T) {
	srv, _ := historyServer(t)
	got, err := silo.New(nil).ShowGuids(t.Context(), conn(srv.URL, key), "show-1")
	if err != nil {
		t.Fatal(err)
	}
	if want := "tvdb://81189 tmdb://1396 imdb://tt0903747"; strings.Join(got, " ") != want {
		t.Errorf("guids = %v, want %s", got, want)
	}
}

func TestShowGuidsOfAMissingShowIsNotFound(t *testing.T) {
	srv, _ := historyServer(t)
	_, err := silo.New(nil).ShowGuids(t.Context(), conn(srv.URL, key), "nope")
	var pe *plugin.Error
	if !errors.As(err, &pe) || pe.Code != plugin.CodeNotFound {
		t.Fatalf("err = %v, want not_found", err)
	}
}
