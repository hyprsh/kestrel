package jobs_test

import (
	"context"
	"errors"
	"testing"

	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/store/storetest"
)

func openRunLog(t *testing.T, dir string) (*store.Store, *jobs.StoreRunLog) {
	t.Helper()
	st, err := store.Open(context.Background(), store.Options{Dir: dir})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return st, jobs.NewStoreRunLog(st)
}

func TestARestartKeepsTheLastTenRunsOfEachLoop(t *testing.T) {
	ctx := context.Background()
	dir := storetest.Dir(t)
	st, log := openRunLog(t, dir)

	first := jobs.New(nil)
	first.UseRunLog(log)
	fail := false
	first.Add(jobs.Loop{Name: "a", Every: hourly, Run: func(context.Context) error {
		if fail {
			return errors.New("boom")
		}
		return nil
	}})
	first.Add(jobs.Loop{Name: "b", Every: hourly, Run: func(context.Context) error { return nil }})
	for i := range 13 {
		fail = i == 12
		_ = first.Pass(ctx, "a")
	}
	_ = first.Pass(ctx, "b")
	st.Close()

	// A new process opens the same database; the loop has not run yet.
	_, log = openRunLog(t, dir)
	second := jobs.New(nil)
	second.UseRunLog(log)
	// A pass that waits keeps the new process from adding to the runs it has loaded.
	hold := func(ctx context.Context) error { <-ctx.Done(); return nil }
	for _, name := range []string{"a", "b", "c"} {
		second.Add(jobs.Loop{Name: name, Every: hourly, Run: hold})
	}
	runCtx, cancel := context.WithCancel(ctx)
	done := make(chan error)
	go func() { done <- second.Run(runCtx) }()
	t.Cleanup(func() { cancel(); <-done })
	waitFor(t, "the loops to be passing", func() bool { return len(second.Running()) == 3 })

	byName := map[string]jobs.Job{}
	for _, j := range second.Jobs() {
		byName[j.Name] = j
	}
	a := byName["a"]
	if len(a.Recent) != jobs.RecentPasses {
		t.Fatalf("a kept %d runs, want %d", len(a.Recent), jobs.RecentPasses)
	}
	if a.Last == nil || a.Last.Err != "boom" || a.Recent[len(a.Recent)-1].Err != "boom" || a.Recent[0].Err != "" {
		t.Errorf("a's runs = %+v, last %+v; want the failing pass last, oldest first", a.Recent, a.Last)
	}
	if a.Last.StartedAt.IsZero() || a.Last.FinishedAt.Before(a.Last.StartedAt) || a.Last.Took < 0 {
		t.Errorf("a's last run lost its times: %+v", a.Last)
	}
	if len(byName["b"].Recent) != 1 || len(byName["c"].Recent) != 0 || byName["c"].Last != nil {
		t.Errorf("b has %d runs, c has %d", len(byName["b"].Recent), len(byName["c"].Recent))
	}

	// The table never holds more than ten per loop.
	runs, err := log.Load(ctx)
	if err != nil || len(runs["a"]) != jobs.RecentPasses {
		t.Errorf("stored a-runs = %d (%v), want %d", len(runs["a"]), err, jobs.RecentPasses)
	}
}
