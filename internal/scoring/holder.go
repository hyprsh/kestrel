package scoring

import (
	"sync"
	"sync/atomic"
)

// Holder is the active TRaSH snapshot. Readers take Current for a quick look
// and Hold across a whole decision (a search, a Grab, an Import) so that the
// snapshot and the stored Scores they compare cannot change halfway. A TRaSH
// update, or a Primary Language change, runs inside Exclusive: it waits for the
// decisions in flight, re-scores every file and swaps the snapshot, and
// decisions that start afterwards see only the new state (Settled 6).
type Holder struct {
	gate   sync.RWMutex
	cur    atomic.Pointer[Snapshot]
	onSwap []func()
}

// NewHolder returns a Holder with snap active.
func NewHolder(snap *Snapshot) *Holder {
	h := &Holder{}
	h.cur.Store(snap)
	return h
}

// Current is the active snapshot.
func (h *Holder) Current() *Snapshot { return h.cur.Load() }

// Hold blocks swaps until the returned function is called. Do not call Hold
// again, or Exclusive, before releasing it.
func (h *Holder) Hold() (release func()) {
	h.gate.RLock()
	return h.gate.RUnlock
}

// Exclusive runs fn with no decision in flight and none starting.
func (h *Holder) Exclusive(fn func() error) error {
	h.gate.Lock()
	defer h.gate.Unlock()
	return fn()
}

// Set makes snap active and runs the OnSwap hooks. Call it from inside Exclusive.
func (h *Holder) Set(snap *Snapshot) {
	h.cur.Store(snap)
	for _, f := range h.onSwap {
		f()
	}
}

// OnSwap registers fn to run on every Set, to drop what was computed under the
// old snapshot. Register before use.
func (h *Holder) OnSwap(fn func()) { h.onSwap = append(h.onSwap, fn) }
