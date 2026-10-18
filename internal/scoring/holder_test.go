package scoring_test

import (
	"sync/atomic"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/scoring"
)

func TestHolderSwapIsInvisibleToReadersHoldingTheGate(t *testing.T) {
	a := newFakeSnapshot().load(t)
	b := newFakeSnapshot().load(t)
	h := scoring.NewHolder(a)
	if h.Current() != a {
		t.Fatal("Current is not the initial snapshot")
	}
	var purged atomic.Int32
	h.OnSwap(func() { purged.Add(1) })

	release := h.Hold()
	swapped := make(chan struct{})
	go func() {
		_ = h.Exclusive(func() error { h.Set(b); return nil })
		close(swapped)
	}()
	select {
	case <-swapped:
		t.Fatal("the swap went through while a decision held the gate")
	case <-time.After(50 * time.Millisecond):
	}
	if h.Current() != a {
		t.Fatal("the snapshot changed under a reader")
	}
	release()
	<-swapped
	if h.Current() != b || purged.Load() != 1 {
		t.Fatalf("after the swap: current ok=%v purged=%d", h.Current() == b, purged.Load())
	}
}

func TestCommittedAtIsRead(t *testing.T) {
	s, err := scoring.Embedded()
	if err != nil {
		t.Fatal(err)
	}
	if got := s.CommittedAt(); !got.Equal(time.Date(2026, 10, 12, 17, 15, 34, 0, time.UTC)) {
		t.Errorf("CommittedAt = %v", got)
	}
}
