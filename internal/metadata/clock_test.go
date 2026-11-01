package metadata_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
)

func TestClockOfReadsTheDateHeaderAndCorrectsForAgeAndTheTripThere(t *testing.T) {
	sent := time.Date(2026, 11, 1, 12, 0, 10, 0, time.UTC)
	received := sent.Add(2 * time.Second)
	h := http.Header{"Date": {"Sun, 01 Nov 2026 12:00:00 GMT"}}
	ref, local, ok := metadata.ClockOf(h, sent, received)
	if !ok || !ref.Equal(time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)) || !local.Equal(sent.Add(time.Second)) {
		t.Fatalf("reference %v local %v ok %v", ref, local, ok)
	}

	// A copy a cache served is as old as its Age says: the origin's Date plus that is now.
	h.Set("Age", "9")
	if ref, _, _ := metadata.ClockOf(h, sent, received); !ref.Equal(time.Date(2026, 11, 1, 12, 0, 9, 0, time.UTC)) {
		t.Errorf("with Age 9: reference %v", ref)
	}

	for name, h := range map[string]http.Header{"none": {}, "garbage": {"Date": {"yesterday-ish"}}} {
		if _, _, ok := metadata.ClockOf(h, sent, received); ok {
			t.Errorf("%s: a reference from a header that has none", name)
		}
	}
}

func TestTMDBReportsItsClockOnEveryAnswerEvenARefusal(t *testing.T) {
	srv := metadatatest.New(t)
	var got []time.Time
	tm := metadata.NewTMDB(metadata.TMDBOptions{
		BaseURL: srv.APIBase(), Keys: metadata.StaticKey("wrong"),
		OnClock: func(reference, local time.Time) { got = append(got, reference, local) },
	})
	if _, err := tm.Search(context.Background(), "paddington"); err == nil {
		t.Fatal("a wrong key was accepted")
	}
	if len(got) != 2 || got[0].IsZero() || time.Since(got[0]) > time.Minute || got[1].Before(got[0].Add(-time.Minute)) {
		t.Fatalf("clock reports = %v, want the server's Date and the local time of the answer", got)
	}
}

func TestTMDBWithoutADateHeaderReportsNothing(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header()["Date"] = nil // net/http leaves the header out when it is nil
		_, _ = w.Write([]byte(`{"results":[]}`))
	}))
	t.Cleanup(srv.Close)
	called := false
	tm := metadata.NewTMDB(metadata.TMDBOptions{BaseURL: srv.URL, Keys: metadata.StaticKey("k"), OnClock: func(_, _ time.Time) { called = true }})
	if _, err := tm.Search(context.Background(), "x"); err != nil {
		t.Fatal(err)
	}
	if called {
		t.Error("a clock reading without a Date header")
	}
}
