package api

import (
	"context"
	"sync"
	"time"

	"github.com/hyprsh/kestrel/internal/store"
)

// cacheFreshness is how long a cached answer serves a later request when the database has not changed: what the answers
// say moves with the clock (a day turns, a Title becomes Long Missing) by days, so a minute of lag is not seen.
const cacheFreshness = time.Minute

// cacheEntries is the most answers one dbCache keeps (a few ranges or windows); more clear it.
const cacheEntries = 16

// dbCache keeps answers that are read from the database and slow to build, by what asked for them. An answer is served until
// anything is committed to the database (store.DataVersion changes) or cacheFreshness has passed. Answers must be read, not changed.
type dbCache[T any] struct {
	mu      sync.Mutex
	entries map[string]dbCacheEntry[T]
}

type dbCacheEntry[T any] struct {
	version int64
	at      time.Time
	val     T
}

// get returns the answer for key, building it with build when there is none that is current. now is the clock the answer is for.
func (c *dbCache[T]) get(ctx context.Context, st *store.Store, now time.Time, key string, build func() (T, error)) (T, error) {
	var zero T
	version, err := st.DataVersion(ctx)
	if err != nil {
		return zero, err
	}
	c.mu.Lock()
	defer c.mu.Unlock() // one build at a time: a second caller waits for it and then reads it
	if e, ok := c.entries[key]; ok && e.version == version {
		if age := now.Sub(e.at); age >= 0 && age < cacheFreshness {
			return e.val, nil
		}
	}
	val, err := build()
	if err != nil {
		return zero, err
	}
	if c.entries == nil || len(c.entries) >= cacheEntries {
		c.entries = map[string]dbCacheEntry[T]{}
	}
	// The version read before the build: a commit during it makes the next call build again.
	c.entries[key] = dbCacheEntry[T]{version: version, at: now, val: val}
	return val, nil
}
