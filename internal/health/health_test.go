package health_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/health"
	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/store/storetest"
)

type env struct {
	h    *health.Service
	hist *history.Service
	now  *time.Time
}

func newEnv(t *testing.T, mod ...func(*health.Deps)) env {
	t.Helper()
	st, err := store.Open(context.Background(), store.Options{Dir: storetest.Dir(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	now := time.Date(2026, 10, 18, 9, 0, 0, 0, time.UTC)
	clock := func() time.Time { return now }
	hist := history.New(st, clock, nil)
	d := health.Deps{Store: st, Clock: clock, History: hist}
	for _, m := range mod {
		m(&d)
	}
	return env{h: health.New(d), hist: hist, now: &now}
}

func (e env) rows(t *testing.T) []health.Row {
	t.Helper()
	rows, err := e.h.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func (e env) kinds(t *testing.T) []history.Kind {
	t.Helper()
	evs, _ := e.hist.After(context.Background(), 0, 100)
	var out []history.Kind
	for _, ev := range evs {
		out = append(out, ev.Kind)
	}
	return out
}

var exdev = health.Issue{
	Key: "exdev:/data/media/movies", Kind: health.KindEXDEV, Severity: health.Warning, Dismissible: true,
	Message: "Imports into /data/media/movies copy instead of moving",
}

func TestRaisingARowShowsItAndClearingItRemovesIt(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)

	if err := e.h.Raise(ctx, health.Issue{
		Key: "sabnzbd", Kind: health.KindDownloadClient, Severity: health.Blocking,
		Subject: health.Subject{PluginInstanceID: 7}, Message: "SABnzbd is unreachable",
	}); err != nil {
		t.Fatal(err)
	}

	rows := e.rows(t)
	if len(rows) != 1 {
		t.Fatalf("rows = %+v", rows)
	}
	r := rows[0]
	if r.Key != "sabnzbd" || r.Kind != health.KindDownloadClient || r.Severity != health.Blocking ||
		r.Subject.PluginInstanceID != 7 || r.Message != "SABnzbd is unreachable" || r.Count != 1 || !r.FirstAt.Equal(*e.now) {
		t.Errorf("row = %+v", r)
	}

	if err := e.h.Clear(ctx, "sabnzbd"); err != nil {
		t.Fatal(err)
	}
	if rows := e.rows(t); len(rows) != 0 {
		t.Errorf("rows after Clear = %+v", rows)
	}
	if err := e.h.Clear(ctx, "sabnzbd"); err != nil {
		t.Errorf("clearing a row that is not there = %v, want nil", err)
	}
}

func TestRaisingAgainBumpsTheCountAndKeepsTheFirstSighting(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	first := *e.now
	_ = e.h.Raise(ctx, exdev)
	*e.now = e.now.Add(time.Hour)
	changed := exdev
	changed.Message = "newer wording"
	_ = e.h.Raise(ctx, changed)

	rows := e.rows(t)
	if len(rows) != 1 || rows[0].Count != 2 || !rows[0].FirstAt.Equal(first) || !rows[0].LastAt.Equal(*e.now) || rows[0].Message != "newer wording" {
		t.Errorf("rows = %+v", rows)
	}
}

func TestTheLogHearsOfARowOnlyWhenItAppearsAndWhenItGoes(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)

	_ = e.h.Raise(ctx, exdev)
	_ = e.h.Raise(ctx, exdev)
	_ = e.h.Clear(ctx, exdev.Key)
	_ = e.h.Clear(ctx, exdev.Key)

	got := e.kinds(t)
	want := []history.Kind{history.HealthRaised, history.HealthCleared}
	if len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Errorf("events = %v, want %v", got, want)
	}
	if history.IsRoutine(history.HealthRaised) || history.IsRoutine(history.HealthCleared) {
		t.Error("health events are kept forever, not routine")
	}
}

func TestDismissHidesAOneOffWarningUntilItRecurs(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	_ = e.h.Raise(ctx, exdev)
	id := e.rows(t)[0].ID

	if err := e.h.Dismiss(ctx, id); err != nil {
		t.Fatal(err)
	}
	if rows := e.rows(t); len(rows) != 0 {
		t.Fatalf("a dismissed row still shows: %+v", rows)
	}

	_ = e.h.Raise(ctx, exdev)
	if rows := e.rows(t); len(rows) != 1 || rows[0].Count != 2 {
		t.Errorf("a recurring row should show again: %+v", rows)
	}
}

func TestOnlyDismissibleRowsCanBeDismissed(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	_ = e.h.Raise(ctx, health.Issue{Key: "sabnzbd", Kind: health.KindDownloadClient, Severity: health.Blocking, Message: "down"})
	id := e.rows(t)[0].ID

	if err := e.h.Dismiss(ctx, id); !errors.Is(err, health.ErrNotDismissible) {
		t.Errorf("Dismiss = %v, want ErrNotDismissible", err)
	}
	if err := e.h.Dismiss(ctx, 999); !errors.Is(err, health.ErrNotFound) {
		t.Errorf("Dismiss(unknown) = %v, want ErrNotFound", err)
	}
	if len(e.rows(t)) != 1 {
		t.Error("the row should still show")
	}
}

func TestClearExceptRemovesTheRowsOfAKindThatNoLongerHold(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	for _, k := range []string{"indexer:1", "indexer:2", "indexer:3"} {
		_ = e.h.Raise(ctx, health.Issue{Key: k, Kind: health.KindIndexer, Severity: health.Warning, Message: k})
	}
	_ = e.h.Raise(ctx, health.Issue{Key: "sabnzbd", Kind: health.KindDownloadClient, Severity: health.Blocking, Message: "x"})

	if err := e.h.ClearExcept(ctx, health.KindIndexer, "indexer:2"); err != nil {
		t.Fatal(err)
	}

	var keys []string
	for _, r := range e.rows(t) {
		keys = append(keys, r.Key)
	}
	if len(keys) != 2 || keys[0] != "indexer:2" || keys[1] != "sabnzbd" {
		t.Errorf("keys = %v", keys)
	}
}
