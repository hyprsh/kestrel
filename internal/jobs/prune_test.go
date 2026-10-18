package jobs_test

import (
	"context"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/jobs"
)

type countingHistory struct{ runs int }

func (h *countingHistory) Prune(context.Context) (int64, error) { h.runs++; return 0, nil }

type memState map[string][]byte

func (m memState) Get(_ context.Context, k string) ([]byte, bool, error) {
	v, ok := m[k]
	return v, ok, nil
}
func (m memState) Put(_ context.Context, k string, v []byte) error { m[k] = v; return nil }

func TestPruningIsCheckedHourlyAndRunsOnceTheLastRunIsOverADayOld(t *testing.T) {
	h, sessions := &countingHistory{}, 0
	clock := now
	r := jobs.Standard(jobs.Deps{
		Acquire: &fakeAcquire{}, Library: &fakeLibrary{}, History: h, PruneState: memState{},
		Sessions: func(context.Context) error { sessions++; return nil }, Clock: func() time.Time { return clock },
	})
	ctx := context.Background()

	if got := r.Every(jobs.Prune); got != time.Hour {
		t.Errorf("prune is checked every %v, want 1h", got)
	}
	_ = r.Pass(ctx, jobs.Prune)
	clock = clock.Add(23 * time.Hour)
	_ = r.Pass(ctx, jobs.Prune)
	if h.runs != 1 || sessions != 1 {
		t.Fatalf("after 23 h: events pruned %d times, sessions %d, want once each", h.runs, sessions)
	}
	clock = clock.Add(2 * time.Hour)
	_ = r.Pass(ctx, jobs.Prune)
	if h.runs != 2 || sessions != 2 {
		t.Errorf("after 25 h: events pruned %d times, sessions %d, want twice each", h.runs, sessions)
	}
}
