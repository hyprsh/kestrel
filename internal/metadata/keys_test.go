package metadata_test

import (
	"context"
	"testing"

	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
	"github.com/hyprsh/kestrel/internal/settings"
	"github.com/hyprsh/kestrel/internal/store"
)

func newSettings(t *testing.T) *settings.Settings {
	t.Helper()
	st, err := store.Open(context.Background(), store.Options{Dir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return settings.New(st)
}

func TestKeyPrecedenceIsUIOverrideThenEnvironmentThenEmbedded(t *testing.T) {
	ctx := context.Background()
	s := newSettings(t)
	keys := metadata.Keys{Settings: s, Env: "env-key", Embedded: "embedded-key"}

	got := func(k metadata.Keys) string {
		t.Helper()
		key, err := k.TMDB(ctx)
		if err != nil {
			t.Fatal(err)
		}
		return key
	}

	if err := s.Put(ctx, metadata.SettingsKey, []byte(`{"tmdb_api_key":"ui-key"}`)); err != nil {
		t.Fatal(err)
	}
	if k := got(keys); k != "ui-key" {
		t.Errorf("with a UI override: %q", k)
	}

	// An override cleared in the UI falls through.
	if err := s.Put(ctx, metadata.SettingsKey, []byte(`{"tmdb_api_key":""}`)); err != nil {
		t.Fatal(err)
	}
	if k := got(keys); k != "env-key" {
		t.Errorf("with the environment variable: %q", k)
	}

	keys.Env = ""
	if k := got(keys); k != "embedded-key" {
		t.Errorf("with only the embedded key: %q", k)
	}

	// The default build carries no key at all.
	if k := got(metadata.NewKeys(s, "")); k != "" {
		t.Errorf("default build embeds %q, want none", k)
	}
}

func TestTheClientSendsTheKeyThePrecedenceChose(t *testing.T) {
	ctx := context.Background()
	s := newSettings(t)
	srv := metadatatest.New(t)
	tm := metadata.NewTMDB(metadata.TMDBOptions{
		BaseURL: srv.APIBase(),
		Keys:    metadata.Keys{Settings: s, Env: "env-key", Embedded: metadatatest.Key},
	})

	// Only the embedded key is the fake's valid one.
	if _, err := tm.Search(ctx, "paddington"); err == nil {
		t.Fatal("the environment key outranks the embedded one, and the fake refuses it")
	}
	if err := s.Put(ctx, metadata.SettingsKey, []byte(`{"tmdb_api_key":"`+metadatatest.Key+`"}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := tm.Search(ctx, "paddington"); err != nil {
		t.Fatalf("with the UI override: %v", err)
	}
	if seen := srv.KeysSeen(); len(seen) != 2 || seen[0] != "env-key" || seen[1] != metadatatest.Key {
		t.Errorf("keys on the wire = %v", seen)
	}
}
