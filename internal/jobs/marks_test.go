package jobs_test

import (
	"context"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/jobs"
)

type marksPass struct{ n int }

func (m *marksPass) Run(context.Context) error { m.n++; return nil }

func TestMarksInPlexRunsEveryTenMinutes(t *testing.T) {
	m := &marksPass{}
	r := jobs.Standard(jobs.Deps{Acquire: &fakeAcquire{}, Library: &fakeLibrary{}, Marks: m, Clock: func() time.Time { return now }})
	if got := r.Every(jobs.Marks); got != 10*time.Minute {
		t.Fatalf("every %v", got)
	}
	if err := r.Pass(context.Background(), jobs.Marks); err != nil || m.n != 1 {
		t.Fatalf("pass: %v, runs %d", err, m.n)
	}
}

func TestWithoutMarksThereIsNoMarksLoop(t *testing.T) {
	r := jobs.Standard(jobs.Deps{Acquire: &fakeAcquire{}, Library: &fakeLibrary{}, Clock: func() time.Time { return now }})
	if r.Every(jobs.Marks) != 0 {
		t.Fatal("a marks loop exists")
	}
}
