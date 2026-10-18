package api_test

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/api"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
)

// shiftingMeta serves the recorded TMDB fixtures until told that Paddington
// changed its name or vanished.
type shiftingMeta struct {
	metadata.Provider
	retitled atomic.Bool
	vanished atomic.Bool
}

func (s *shiftingMeta) Movie(ctx context.Context, id int) (metadata.MovieDetails, error) {
	if s.vanished.Load() {
		return metadata.MovieDetails{}, &metadata.Error{Code: metadata.CodeNotFound, Message: "TMDB has no such record"}
	}
	d, err := s.Provider.Movie(ctx, id)
	if s.retitled.Load() {
		d.Title, d.Year = "Paddington Bear", 2015
	}
	return d, err
}

func newRefreshInstance(t *testing.T) (library, *shiftingMeta) {
	t.Helper()
	tmdb := metadatatest.New(t)
	tvdb := metadatatest.NewTVDB(t)
	data, config := t.TempDir(), t.TempDir()
	meta := &shiftingMeta{Provider: metadata.NewTMDB(metadata.TMDBOptions{BaseURL: tmdb.APIBase(), ImageBase: tmdb.ImageBase(), Keys: metadata.StaticKey(metadatatest.Key)})}
	in := newInstance(t, "", func(o *api.Options) {
		o.DataDir, o.ConfigDir = data, config
		o.Metadata = meta
		o.TVDB = metadata.NewTVDB(metadata.TVDBOptions{BaseURL: tvdb.APIBase(), Keys: metadata.StaticTVDBKey(metadatatest.TVDBKey)})
		o.Posters = metadata.NewPosters(metadata.PostersOptions{ConfigDir: config, ImageBase: tmdb.ImageBase()})
	})
	return library{browser: in.setUp(), tmdb: tmdb, tvdb: tvdb, config: config, data: data}, meta
}

func eventually(t *testing.T, what string, ok func() bool) {
	t.Helper()
	for range 200 {
		if ok() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("gave up waiting for %s", what)
}

func TestAManualRefreshReturns202AndAppliesTheChange(t *testing.T) {
	l, meta := newRefreshInstance(t)
	created := decode[titleJSON](t, l.valid("POST", "/titles", addPaddington))
	path := fmt.Sprintf("/titles/%d", created.ID)
	meta.retitled.Store(true)

	if r := l.valid("POST", path+"/refresh", ""); r.Status != 202 {
		t.Fatalf("POST refresh = %d %s", r.Status, r.Body)
	}

	eventually(t, "the refresh to apply", func() bool {
		return decode[titleJSON](t, l.valid("GET", path, "")).Title == "Paddington Bear"
	})
	if r := l.valid("POST", "/titles/9999/refresh", ""); r.Status != 404 {
		t.Errorf("refresh of a missing Title = %d", r.Status)
	}
}

func TestAVanishedUpstreamEntryRaisesTheRowAndKeepAsIsFreezesTheTitleAndClearsIt(t *testing.T) {
	l, meta := newRefreshInstance(t)
	created := decode[titleJSON](t, l.valid("POST", "/titles", addPaddington))
	path := fmt.Sprintf("/titles/%d", created.ID)
	meta.vanished.Store(true)
	l.valid("POST", path+"/refresh", "")

	var row attentionRowJSON
	eventually(t, "the Title gone upstream row", func() bool {
		a := l.attention(t)
		if !a.has("title_gone_upstream") {
			return false
		}
		row = a.row(t, "title_gone_upstream")
		return true
	})
	if row.Severity != "warning" || len(row.Actions) != 2 || row.Actions[0].Key != "remove" || row.Actions[0].Method != "DELETE" ||
		row.Actions[0].Path != path || row.Actions[0].Confirm == nil || row.Actions[1].Key != "keep" || row.Actions[1].Method != "PATCH" ||
		row.Actions[1].Body["metadata_frozen"] != true {
		t.Fatalf("row = %+v", row)
	}
	if got := decode[titleJSON](t, l.valid("GET", path, "")); got.Title != "Paddington" {
		t.Errorf("stored data changed: %+v", got)
	}

	keep := row.Actions[1]
	if r := l.valid(keep.Method, keep.Path, `{"metadata_frozen":true}`); r.Status != 200 {
		t.Fatalf("keep = %d %s", r.Status, r.Body)
	}
	if l.attention(t).has("title_gone_upstream") {
		t.Error("the row stayed after Keep as is")
	}
	if got := decode[struct {
		Frozen bool `json:"metadata_frozen"`
	}](t, l.valid("GET", path, "")); !got.Frozen {
		t.Error("the Title is not frozen")
	}

	// A frozen Title is not refreshed again.
	l.valid("POST", path+"/refresh", "")
	time.Sleep(100 * time.Millisecond)
	if l.attention(t).has("title_gone_upstream") {
		t.Error("a frozen Title raised the row again")
	}
}

func TestRemovingATitleGoneUpstreamClearsItsRow(t *testing.T) {
	l, meta := newRefreshInstance(t)
	created := decode[titleJSON](t, l.valid("POST", "/titles", addPaddington))
	path := fmt.Sprintf("/titles/%d", created.ID)
	meta.vanished.Store(true)
	l.valid("POST", path+"/refresh", "")
	eventually(t, "the row", func() bool { return l.attention(t).has("title_gone_upstream") })

	if r := l.valid("DELETE", path, ""); r.Status != 204 {
		t.Fatalf("remove = %d %s", r.Status, r.Body)
	}
	if l.attention(t).has("title_gone_upstream") {
		t.Error("the row outlived the Title")
	}
}
