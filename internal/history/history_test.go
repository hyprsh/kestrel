package history_test

import (
	"context"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/store/storetest"
)

func newService(t *testing.T, now *time.Time) *history.Service {
	t.Helper()
	st, err := store.Open(context.Background(), store.Options{Dir: storetest.Dir(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return history.New(st, func() time.Time { return *now }, nil)
}

func TestRecordedEventsComeBackInOrderAfterAGivenID(t *testing.T) {
	ctx := testCtx()
	now := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	h := newService(t, &now)

	if last, err := h.Last(ctx); err != nil || last != 0 {
		t.Fatalf("Last on an empty log = %d, %v", last, err)
	}
	h.Record(ctx, history.Event{Reason: "test", Kind: history.GrabSent, Message: "first", Data: []byte(`{"score":7}`)})
	h.Record(ctx, history.Event{Reason: "test", Kind: history.GrabCompleted, Message: "second"})
	h.Record(ctx, history.Event{Reason: "test", Kind: history.GrabFailed, Message: "third"})

	all, err := h.After(ctx, 0, 100)
	if err != nil || len(all) != 3 {
		t.Fatalf("After(0) = %+v, %v", all, err)
	}
	if all[0].Message != "first" || all[0].Kind != history.GrabSent || !all[0].At.Equal(now) || all[0].Routine {
		t.Errorf("first = %+v", all[0])
	}
	if !all[1].Routine {
		t.Errorf("a completed download is a routine event: %+v", all[1])
	}
	if string(all[0].Data) != `{"score":7}` {
		t.Errorf("data = %s", all[0].Data)
	}
	rest, _ := h.After(ctx, all[0].ID, 100)
	if len(rest) != 2 || rest[0].Message != "second" {
		t.Errorf("After(first) = %+v", rest)
	}
	if last, _ := h.Last(ctx); last != all[2].ID {
		t.Errorf("Last = %d, want %d", last, all[2].ID)
	}
}

func TestPruneDropsOnlyRoutineEventsOlderThanThirtyDays(t *testing.T) {
	ctx := testCtx()
	now := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	h := newService(t, &now)

	h.Record(ctx, history.Event{Reason: "test", Kind: history.GrabCompleted, Message: "old routine"})
	h.Record(ctx, history.Event{Reason: "test", Kind: history.GrabFailed, Message: "old kept"})
	now = now.Add(31 * 24 * time.Hour)
	h.Record(ctx, history.Event{Reason: "test", Kind: history.GrabCompleted, Message: "new routine"})

	n, err := h.Prune(ctx)
	if err != nil || n != 1 {
		t.Fatalf("Prune = %d, %v", n, err)
	}
	left, _ := h.After(ctx, 0, 100)
	if len(left) != 2 || left[0].Message != "old kept" || left[1].Message != "new routine" {
		t.Errorf("left = %+v", left)
	}
}

func TestRecordingOnANilServiceDoesNothing(t *testing.T) {
	var h *history.Service
	h.Record(context.Background(), history.Event{Reason: "test", Kind: history.GrabSent})
}

func TestSummaryCountsEventsByKindAndFindsTheOldest(t *testing.T) {
	ctx := testCtx()
	now := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	h := newService(t, &now)

	if s, err := h.Summary(ctx); err != nil || len(s.Counts) != 0 || !s.Oldest.IsZero() {
		t.Fatalf("Summary of an empty log = %+v, %v", s, err)
	}
	h.Record(ctx, history.Event{Reason: "test", Kind: history.GrabFailed, Message: "a"})
	now = now.Add(time.Hour)
	h.Record(ctx, history.Event{Reason: "test", Kind: history.GrabFailed, Message: "b"})
	h.Record(ctx, history.Event{Reason: "test", Kind: history.Searched, Message: "c"})

	s, err := h.Summary(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if s.Counts[history.GrabFailed] != 2 || s.Counts[history.Searched] != 1 || len(s.Counts) != 2 {
		t.Errorf("Counts = %v, want two failed Grabs and one routine search", s.Counts)
	}
	if want := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC); !s.Oldest.Equal(want) {
		t.Errorf("Oldest = %v, want %v", s.Oldest, want)
	}
}

func TestHistogramCountsEventsPerBucketBySeverityAndFillsEmptyBuckets(t *testing.T) {
	ctx := testCtx()
	now := time.Date(2026, 10, 17, 13, 30, 0, 0, time.UTC)
	h := newService(t, &now)

	at := func(d time.Duration, kinds ...history.Kind) {
		now = time.Date(2026, 10, 17, 13, 30, 0, 0, time.UTC).Add(d)
		for _, k := range kinds {
			h.Record(ctx, history.Event{Reason: "test", Kind: k, Message: "x"})
		}
	}
	at(-10*24*time.Hour, history.GrabSent)                                      // before the window
	at(-2*24*time.Hour, history.GrabSent, history.Searched, history.GrabFailed) // the 4h bucket from 12:00 two days ago
	at(-2*24*time.Hour+time.Hour, history.ImportRejected, history.Blocklisted, history.HealthRaised)
	at(0, history.ImportDone, history.ImportStalled)
	now = time.Date(2026, 10, 17, 13, 30, 0, 0, time.UTC)

	got, err := h.Histogram(ctx, 4*time.Hour, 3)
	if err != nil {
		t.Fatal(err)
	}
	// Three days back from 13:30 starts in the bucket at 12:00, so 18 buckets and the one now falls in.
	if len(got) != 19 {
		t.Fatalf("%d buckets, want 19", len(got))
	}
	if want := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC); !got[0].Start.Equal(want) {
		t.Errorf("first bucket starts %v, want %v", got[0].Start, want)
	}
	if last := got[len(got)-1]; !last.Start.Equal(time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)) || last.Events != 1 || last.Warnings != 1 || last.Errors != 0 {
		t.Errorf("last bucket = %+v, want one event and one warning from 12:00", last)
	}
	var total struct{ events, warnings, errors int64 }
	for _, b := range got {
		total.events += b.Events
		total.warnings += b.Warnings
		total.errors += b.Errors
	}
	if total.events != 3 || total.warnings != 2 || total.errors != 3 {
		t.Errorf("totals = %+v, want 3 events, 2 warnings and 3 errors, the event ten days ago left out", total)
	}
	two := got[len(got)-1-12] // two days before the last bucket: 12:00 on the 15th
	if two.Events != 2 || two.Errors != 3 || two.Warnings != 1 {
		t.Errorf("bucket two days back = %+v", two)
	}
}
