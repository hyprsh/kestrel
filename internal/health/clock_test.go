package health_test

import (
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/health"
)

func TestTheClockIsInSyncWithinAMinuteAndAWarningBeyondIt(t *testing.T) {
	ctx := testCtx()
	e := newEnv(t)
	if _, ok := e.h.Clock(); ok {
		t.Fatal("a sample before any comparison")
	}
	ref := *e.now

	e.h.ObserveClock(ctx, "TMDB", ref.Add(-45*time.Second), *e.now) // the server is 45 s ahead
	if s, ok := e.h.Clock(); !ok || s.Drifting() || s.Offset != 45*time.Second || s.Source != "TMDB" {
		t.Fatalf("sample = %+v", s)
	}
	if rows := e.rows(t); len(rows) != 0 {
		t.Fatalf("rows within the tolerance: %+v", rows)
	}

	e.h.ObserveClock(ctx, "TMDB", ref.Add(3*time.Minute), *e.now) // behind by 3 min
	rows := e.rows(t)
	if len(rows) != 1 || rows[0].Kind != health.KindClock || rows[0].Severity != health.Warning || rows[0].Key != health.ClockKey ||
		rows[0].Message != "The server's clock is 3 min behind TMDB's" {
		t.Fatalf("rows = %+v", rows)
	}
	if s, _ := e.h.Clock(); !s.Drifting() || s.Offset != -3*time.Minute {
		t.Errorf("sample = %+v", s)
	}

	// Another bad sample bumps the same row; a good one clears it.
	e.h.ObserveClock(ctx, "TMDB", ref.Add(4*time.Minute), *e.now)
	if rows := e.rows(t); len(rows) != 1 || rows[0].Count != 2 || rows[0].Message != "The server's clock is 4 min behind TMDB's" {
		t.Fatalf("after a second bad sample: %+v", rows)
	}
	e.h.ObserveClock(ctx, "TMDB", ref.Add(2*time.Second), *e.now)
	if rows := e.rows(t); len(rows) != 0 {
		t.Fatalf("rows after the clock came right: %+v", rows)
	}
}

func TestClockOffsetWords(t *testing.T) {
	for off, want := range map[time.Duration]string{
		0:                         "in sync with",
		-90 * time.Second:         "2 min behind",
		75 * time.Second:          "1 min ahead of",
		-2 * time.Hour:            "2.0 h behind",
		26 * time.Hour:            "26.0 h ahead of",
		-72 * time.Hour:           "3 days behind",
		-61*time.Second - 400*1e6: "1 min behind",
	} {
		if got := health.ClockOffsetWords(off); got != want {
			t.Errorf("%v: %q, want %q", off, got, want)
		}
	}
}
