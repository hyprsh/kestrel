package api

import (
	"sync"
	"time"
)

const (
	throttleWindow    = 15 * time.Minute
	throttleFreeTries = 5
	throttleBase      = 5 * time.Second
	throttleCap       = 15 * time.Minute
)

// throttle slows password guessing per client address, in memory. Five
// failures within 15 minutes start an exponential backoff (5 s, 10 s, 20 s ...)
// capped at 15 minutes; a success forgets the address.
type throttle struct {
	mu      sync.Mutex
	clients map[string]*attempts
}

type attempts struct {
	failures int
	last     time.Time
	until    time.Time
}

func newThrottle() *throttle { return &throttle{clients: map[string]*attempts{}} }

// wait is how long ip must still wait before its next attempt counts.
func (t *throttle) wait(ip string, now time.Time) time.Duration {
	t.mu.Lock()
	defer t.mu.Unlock()
	if a := t.clients[ip]; a != nil && now.Before(a.until) {
		return a.until.Sub(now)
	}
	return 0
}

func (t *throttle) fail(ip string, now time.Time) {
	t.mu.Lock()
	defer t.mu.Unlock()
	for k, a := range t.clients { // forget quiet addresses so the map cannot grow without bound
		if now.Sub(a.last) > throttleWindow && !now.Before(a.until) {
			delete(t.clients, k)
		}
	}
	a := t.clients[ip]
	if a == nil {
		a = &attempts{}
		t.clients[ip] = a
	}
	a.failures++
	a.last = now
	if a.failures >= throttleFreeTries {
		d := throttleBase
		for i := throttleFreeTries; i < a.failures && d < throttleCap; i++ {
			d *= 2
		}
		a.until = now.Add(min(d, throttleCap))
	}
}

func (t *throttle) reset(ip string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.clients, ip)
}
