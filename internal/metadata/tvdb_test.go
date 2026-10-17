package metadata_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
)

func newTVDB(t *testing.T, key string) (*metadata.TVDB, *metadatatest.TVDBServer) {
	t.Helper()
	srv := metadatatest.NewTVDB(t)
	return metadata.NewTVDB(metadata.TVDBOptions{BaseURL: srv.APIBase(), Keys: metadata.StaticTVDBKey(key)}), srv
}

func TestTVDBSeriesInAiredOrderAcrossPages(t *testing.T) {
	tv, srv := newTVDB(t, metadatatest.TVDBKey)
	s, err := tv.Series(context.Background(), 81189)
	if err != nil {
		t.Fatal(err)
	}
	if s.ID != 81189 || s.Name != "Breaking Bad" {
		t.Errorf("series = %+v", s)
	}
	if len(s.Aliases) != 2 || s.Aliases[0] != "Breaking Bad - Total verhext" {
		t.Errorf("aliases = %v", s.Aliases)
	}
	if len(s.Episodes) != 8 {
		t.Fatalf("got %d episodes, want both pages (8): %+v", len(s.Episodes), s.Episodes)
	}
	special := s.Episodes[0]
	if special.Season != 0 || special.Number != 1 || special.ID != 900001 || special.Name != "Good Cop Bad Cop" ||
		special.Aired == nil || !special.Aired.Equal(time.Date(2009, 2, 17, 0, 0, 0, 0, time.UTC)) {
		t.Errorf("special = %+v", special)
	}
	if s.Episodes[6].Aired != nil {
		t.Errorf("an episode without an air date has none, got %v", s.Episodes[6].Aired)
	}
	var paths []string
	for _, r := range srv.Requests() {
		paths = append(paths, r)
	}
	want := []string{"POST /v4/login", "GET /v4/series/81189", "GET /v4/series/81189/episodes/official?page=0", "GET /v4/series/81189/episodes/official?page=1"}
	if len(paths) != len(want) {
		t.Fatalf("requests = %v, want %v", paths, want)
	}
	for i := range want {
		if paths[i] != want[i] {
			t.Errorf("request %d = %q, want %q", i, paths[i], want[i])
		}
	}
}

func TestTVDBLogsInOnceAndSendsTheBearerToken(t *testing.T) {
	tv, srv := newTVDB(t, metadatatest.TVDBKey)
	for range 2 {
		if _, err := tv.Series(context.Background(), 300001); err != nil {
			t.Fatal(err)
		}
	}
	if n := srv.Logins(); n != 1 {
		t.Errorf("logins = %d, want the token reused", n)
	}
	if got := srv.APIKeysSeen(); len(got) != 1 || got[0] != metadatatest.TVDBKey {
		t.Errorf("login keys = %v", got)
	}
}

func TestTVDBLogsInAgainWhenTheTokenIsRefused(t *testing.T) {
	tv, srv := newTVDB(t, metadatatest.TVDBKey)
	if _, err := tv.Series(context.Background(), 300001); err != nil {
		t.Fatal(err)
	}
	srv.ExpireTokens()
	if _, err := tv.Series(context.Background(), 300001); err != nil {
		t.Fatalf("an expired token is replaced: %v", err)
	}
	if n := srv.Logins(); n != 2 {
		t.Errorf("logins = %d, want 2", n)
	}
}

func TestTVDBErrors(t *testing.T) {
	ctx := context.Background()
	code := func(err error) metadata.ErrorCode {
		t.Helper()
		var me *metadata.Error
		if !errors.As(err, &me) {
			t.Fatalf("not a *metadata.Error: %v", err)
		}
		return me.Code
	}
	tv, _ := newTVDB(t, "wrong")
	if _, err := tv.Series(ctx, 81189); code(err) != metadata.CodeAuth {
		t.Errorf("a refused key is auth, got %v", err)
	}
	tv, _ = newTVDB(t, "")
	if _, err := tv.Series(ctx, 81189); code(err) != metadata.CodeAuth {
		t.Errorf("no key is auth, got %v", err)
	}
	tv, _ = newTVDB(t, metadatatest.TVDBKey)
	if _, err := tv.Series(ctx, 424242); code(err) != metadata.CodeNotFound {
		t.Errorf("an unknown series is not_found, got %v", err)
	}
}

func TestTVDBResolvesAnIMDbIDToASeries(t *testing.T) {
	tv, _ := newTVDB(t, metadatatest.TVDBKey)
	id, ok, err := tv.SeriesByIMDb(context.Background(), "tt7777777")
	if err != nil || !ok || id != 300001 {
		t.Fatalf("got %d %v %v", id, ok, err)
	}
	if _, ok, err := tv.SeriesByIMDb(context.Background(), "tt0000000"); err != nil || ok {
		t.Fatalf("an unknown id is not found, not an error: %v %v", ok, err)
	}
}

func TestTVDBKeyPrecedenceMatchesTMDB(t *testing.T) {
	ctx := context.Background()
	s := newSettings(t)
	keys := metadata.Keys{Settings: s, TVDBEnv: "env-key", TVDBEmbedded: "embedded-key"}
	got := func() string {
		t.Helper()
		k, err := keys.TVDB(ctx)
		if err != nil {
			t.Fatal(err)
		}
		return k
	}
	if got() != "env-key" {
		t.Errorf("env should beat embedded, got %q", got())
	}
	if err := s.Put(ctx, metadata.SettingsKey, []byte(`{"tvdb_api_key":"ui-key"}`)); err != nil {
		t.Fatal(err)
	}
	if got() != "ui-key" {
		t.Errorf("UI should beat env, got %q", got())
	}
	keys.Settings = nil
	keys.TVDBEnv = ""
	if got() != "embedded-key" {
		t.Errorf("embedded is the last resort, got %q", got())
	}
}
