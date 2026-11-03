package acquire

import (
	"context"
	"slices"
	"sync"
)

// keyedLock is a mutex per Version id. A call holds several at once, always taken in ascending id order, so two
// calls over overlapping Versions cannot wait on each other. Waiting honours the context.
//
// Lock ordering across the package, outermost first: a Version's search guard (Service.searching), then its Grab
// locks (Service.granting), then the store's write transaction. Nothing takes them in another order, and the
// snapshot gate (snap.Hold) is taken after the search guard, so a search that waits for its turn holds no gate.
type keyedLock struct {
	mu sync.Mutex
	m  map[int64]*keySlot
}

type keySlot struct {
	ch   chan struct{} // holds one token while the key is locked
	refs int           // callers holding or waiting; the slot is dropped at zero
	// queued is set while a coalescing caller waits for the key, so later coalescing callers need not wait too.
	queued bool
}

func newKeyedLock() *keyedLock { return &keyedLock{m: map[int64]*keySlot{}} }

// lock takes every key in ids and returns the function that releases them.
func (k *keyedLock) lock(ctx context.Context, ids []int64) (func(), error) {
	unlock, _, err := k.acquire(ctx, ids, false)
	return unlock, err
}

// lockOnce is lock for a caller whose run would repeat one already waiting: when every key has a coalescing caller
// queued behind its current holder, that caller's run will see this caller's state too, so it reports true and takes
// nothing. The first coalescing caller to find a key held queues; the rest join it.
func (k *keyedLock) lockOnce(ctx context.Context, ids []int64) (func(), bool, error) {
	return k.acquire(ctx, ids, true)
}

func (k *keyedLock) acquire(ctx context.Context, ids []int64, coalesce bool) (func(), bool, error) {
	keys := slices.Clone(ids)
	slices.Sort(keys)
	keys = slices.Compact(keys)

	k.mu.Lock()
	slots := make([]*keySlot, len(keys))
	allQueued := coalesce && len(keys) > 0
	for i, id := range keys {
		sl := k.m[id]
		if sl == nil {
			sl = &keySlot{ch: make(chan struct{}, 1)}
			k.m[id] = sl
		}
		sl.refs++
		slots[i] = sl
		allQueued = allQueued && sl.queued
	}
	if coalesce && !allQueued {
		for _, sl := range slots {
			sl.queued = true
		}
	}
	k.mu.Unlock()

	release := func(held int) {
		k.mu.Lock()
		defer k.mu.Unlock()
		for i, sl := range slots {
			if i < held {
				<-sl.ch
			}
			if sl.refs--; sl.refs == 0 {
				delete(k.m, keys[i])
			}
		}
	}
	if allQueued {
		release(0)
		return nil, true, nil
	}
	for i, sl := range slots {
		select {
		case sl.ch <- struct{}{}:
		case <-ctx.Done():
			k.unqueue(slots, coalesce)
			release(i)
			return nil, false, ctx.Err()
		}
	}
	k.unqueue(slots, coalesce)
	return func() { release(len(slots)) }, false, nil
}

// unqueue clears the queued marks this caller set: it runs now, so a coalescing caller arriving from here on queues a
// follow-up of its own.
func (k *keyedLock) unqueue(slots []*keySlot, coalesce bool) {
	if !coalesce {
		return
	}
	k.mu.Lock()
	for _, sl := range slots {
		sl.queued = false
	}
	k.mu.Unlock()
}
