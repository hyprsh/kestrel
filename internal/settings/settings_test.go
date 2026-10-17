package settings_test

import (
	"context"
	"testing"

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

func TestSettingsRoundTripJSONValues(t *testing.T) {
	s := newSettings(t)
	ctx := context.Background()

	if _, ok, err := s.Get(ctx, "primary_language"); err != nil || ok {
		t.Fatalf("missing key: ok = %v, err = %v", ok, err)
	}
	if err := s.Put(ctx, "primary_language", []byte(`"german"`)); err != nil {
		t.Fatal(err)
	}
	if err := s.Put(ctx, "primary_language", []byte(`"french"`)); err != nil { // overwrite
		t.Fatal(err)
	}
	got, ok, err := s.Get(ctx, "primary_language")
	if err != nil || !ok || string(got) != `"french"` {
		t.Fatalf("got %s, ok = %v, err = %v", got, ok, err)
	}
	if err := s.Put(ctx, "bad", []byte(`not json`)); err == nil {
		t.Fatal("non-JSON value accepted")
	}
}
