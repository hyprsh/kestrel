package jobs_test

import (
	"context"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/jobs"
)

type counter struct{ n int }

func (c *counter) Check(context.Context) error { c.n++; return nil }

// trashCounter is a TrashChecker with nothing requested by hand.
type trashCounter struct{ counter }

func (*trashCounter) RunRequested(context.Context) (bool, error) { return false, nil }

func TestTheUpdateAndTrashChecksAreDailyByTheirLastRunNotByUptime(t *testing.T) {
	updates, trash := &counter{}, &trashCounter{}
	clock := now
	state := memState{}
	build := func() *jobs.Runner {
		return jobs.Standard(jobs.Deps{
			Acquire: &fakeAcquire{}, Library: &fakeLibrary{}, Updates: updates, Trash: trash, LastRun: state,
			Clock: func() time.Time { return clock },
		})
	}
	ctx := context.Background()
	r := build()

	for _, name := range []string{jobs.Updates, jobs.Trash} {
		if got := r.Every(name); got != time.Hour {
			t.Errorf("%s is checked every %v, want hourly", name, got)
		}
		_ = r.Pass(ctx, name)
	}
	clock = clock.Add(23 * time.Hour)
	for _, name := range []string{jobs.Updates, jobs.Trash} {
		_ = r.Pass(ctx, name)
	}
	if updates.n != 1 || trash.n != 1 {
		t.Fatalf("after 23 h: %d update checks, %d TRaSH checks, want one each", updates.n, trash.n)
	}

	// A restart does not run them again: the last run is remembered.
	r = build()
	_ = r.Pass(ctx, jobs.Updates)
	_ = r.Pass(ctx, jobs.Trash)
	if updates.n != 1 || trash.n != 1 {
		t.Fatalf("after a restart: %d update checks, %d TRaSH checks, want one each", updates.n, trash.n)
	}

	clock = clock.Add(2 * time.Hour)
	_ = r.Pass(ctx, jobs.Updates)
	_ = r.Pass(ctx, jobs.Trash)
	if updates.n != 2 || trash.n != 2 {
		t.Errorf("after 25 h: %d update checks, %d TRaSH checks, want two each", updates.n, trash.n)
	}
}
