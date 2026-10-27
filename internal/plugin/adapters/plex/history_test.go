package plex_test

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/adapters/plex"
)

// historyServer serves the fixture history, filtered and paged as Plex does.
// size is the page size it grants, whatever is asked.
func historyServer(t *testing.T) (*httptest.Server, *[]string) {
	t.Helper()
	read := func(name string) []byte {
		b, err := os.ReadFile(filepath.Join("testdata", name))
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	var mu sync.Mutex
	var queries []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Plex-Token") != token {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/status/sessions/history/all":
			mu.Lock()
			queries = append(queries, r.URL.RawQuery)
			mu.Unlock()
			if from := r.URL.Query().Get("viewedAt>"); from != "" {
				if n, _ := strconv.Atoi(from); n > 1760000200 {
					_, _ = w.Write([]byte(`{"MediaContainer":{"size":0,"Metadata":[]}}`))
					return
				}
			}
			_, _ = w.Write(read("history.json"))
		case "/library/metadata/456":
			_, _ = w.Write(read("show.json"))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, &queries
}

func TestPlaysListsEveryAccountsEpisodePlaysOldestFirst(t *testing.T) {
	srv, queries := historyServer(t)
	got, err := plex.New(nil).Plays(t.Context(), conn(srv.URL, token), time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Items) != 3 {
		t.Fatalf("plays = %+v, want the three episode plays and not the movie", got.Items)
	}
	first := got.Items[0]
	if first.ShowKey != "/library/metadata/456" || first.Season != 1 || first.Episode != 1 || first.ViewedAt.Unix() != 1760000000 {
		t.Errorf("first play = %+v", first)
	}
	if got.Through.Unix() != 1760000300 {
		t.Errorf("through = %v, want the newest entry's time", got.Through)
	}
	q := (*queries)[0]
	if !strings.Contains(q, "sort=viewedAt%3Aasc") || strings.Contains(q, "viewedAt%3E") {
		t.Errorf("first read asked %q, want oldest first and no lower bound", q)
	}
}

func TestPlaysReadsFromARememberedPoint(t *testing.T) {
	srv, queries := historyServer(t)
	got, err := plex.New(nil).Plays(t.Context(), conn(srv.URL, token), time.Unix(1760000301, 0))
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Items) != 0 || !got.Through.IsZero() {
		t.Errorf("plays = %+v, want nothing after the point", got)
	}
	if q := (*queries)[0]; !strings.Contains(q, "viewedAt%3E=1760000301") {
		t.Errorf("read asked %q, want viewedAt> 1760000301", q)
	}
}

func TestPlaysNeedsTheOwnersToken(t *testing.T) {
	srv, _ := historyServer(t)
	_, err := plex.New(nil).Plays(t.Context(), conn(srv.URL, "wrong"), time.Time{})
	var pe *plugin.Error
	if !errors.As(err, &pe) || pe.Code != plugin.CodeAuth {
		t.Fatalf("err = %v, want an auth error", err)
	}
}

func TestShowGuidsListsTheShowsExternalIds(t *testing.T) {
	srv, _ := historyServer(t)
	got, err := plex.New(nil).ShowGuids(t.Context(), conn(srv.URL, token), "/library/metadata/456")
	if err != nil {
		t.Fatal(err)
	}
	want := "imdb://tt0903747 tmdb://1396 tvdb://81189 plex://show/5d9c086c46115600200aa2fe"
	if strings.Join(got, " ") != want {
		t.Errorf("guids = %v", got)
	}
}

func TestShowGuidsOfAShowPlexNoLongerHasIsNotFound(t *testing.T) {
	srv, _ := historyServer(t)
	_, err := plex.New(nil).ShowGuids(t.Context(), conn(srv.URL, token), "/library/metadata/999")
	var pe *plugin.Error
	if !errors.As(err, &pe) || pe.Code != plugin.CodeNotFound {
		t.Fatalf("err = %v, want not_found", err)
	}
}

func TestShowGuidsOnlyReadsLibraryMetadata(t *testing.T) {
	srv, queries := historyServer(t)
	for _, key := range []string{"/status/sessions/history/all", "/library/metadata/../../identity", "456"} {
		if _, err := plex.New(nil).ShowGuids(t.Context(), conn(srv.URL, token), key); err == nil {
			t.Errorf("%q was read", key)
		}
	}
	if len(*queries) != 0 {
		t.Errorf("queries = %v", *queries)
	}
}
