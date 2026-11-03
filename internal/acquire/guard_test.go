package acquire

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestKeyedLockHoldsAKeyForOneCallerAtATime(t *testing.T) {
	k := newKeyedLock()
	unlock, err := k.lock(context.Background(), []int64{2, 1})
	if err != nil {
		t.Fatal(err)
	}
	got := make(chan func())
	go func() {
		u, _ := k.lock(context.Background(), []int64{1, 3})
		got <- u
	}()
	select {
	case <-got:
		t.Fatal("a second caller took key 1 while it was held")
	case <-time.After(50 * time.Millisecond):
	}
	unlock()
	select {
	case u := <-got:
		u()
	case <-time.After(2 * time.Second):
		t.Fatal("the waiting caller never got the key")
	}
	k.mu.Lock()
	defer k.mu.Unlock()
	if len(k.m) != 0 {
		t.Errorf("slots left behind: %d", len(k.m))
	}
}

func TestKeyedLockLetsDifferentKeysRunTogether(t *testing.T) {
	k := newKeyedLock()
	a, _ := k.lock(context.Background(), []int64{1})
	defer a()
	done := make(chan struct{})
	go func() {
		b, _ := k.lock(context.Background(), []int64{2})
		b()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("key 2 waited for key 1")
	}
}

func TestKeyedLockWaitStopsWithTheContextAndLeavesNothingHeld(t *testing.T) {
	k := newKeyedLock()
	hold, _ := k.lock(context.Background(), []int64{2})
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if _, err := k.lock(ctx, []int64{1, 2}); err == nil {
		t.Fatal("lock succeeded while key 2 was held")
	}
	hold()
	u, err := k.lock(context.Background(), []int64{1, 2})
	if err != nil {
		t.Fatal(err)
	}
	u()
	k.mu.Lock()
	defer k.mu.Unlock()
	if len(k.m) != 0 {
		t.Errorf("slots left behind: %d", len(k.m))
	}
}

func TestKeyedLockOverlappingSetsDoNotDeadlock(t *testing.T) {
	k := newKeyedLock()
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		ids := []int64{1, 2, 3}
		if i%2 == 1 {
			ids = []int64{3, 2, 1}
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			u, _ := k.lock(context.Background(), ids)
			u()
		}()
	}
	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("deadlock")
	}
}

func TestKeyedLockOnceQueuesOneFollowUp(t *testing.T) {
	k := newKeyedLock()
	ctx := context.Background()
	first, coalesced, _ := k.lockOnce(ctx, []int64{1})
	if coalesced {
		t.Fatal("the first caller coalesced")
	}
	second := make(chan func(), 1)
	go func() {
		u, c, _ := k.lockOnce(ctx, []int64{1})
		if c {
			second <- nil
			return
		}
		second <- u
	}()
	// Wait for the second to queue behind the first.
	for i := 0; ; i++ {
		k.mu.Lock()
		q := k.m[1] != nil && k.m[1].queued
		k.mu.Unlock()
		if q {
			break
		}
		if i > 400 {
			t.Fatal("the second caller never queued")
		}
		time.Sleep(5 * time.Millisecond)
	}
	for i := 0; i < 5; i++ {
		if _, c, _ := k.lockOnce(ctx, []int64{1}); !c {
			t.Fatalf("caller %d did not coalesce into the queued follow-up", i)
		}
	}
	first()
	u := <-second
	if u == nil {
		t.Fatal("the queued caller coalesced instead of running")
	}
	k.mu.Lock()
	queued := k.m[1].queued
	k.mu.Unlock()
	if queued {
		t.Error("the follow-up is running but still marked queued, so the next retry would be swallowed")
	}
	u()
}
