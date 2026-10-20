package imports

import "sync"

// titleGuard serialises Import, Rename and Move for one Title, so a folder is
// never moved or renamed while a file goes into it, and the reverse. It counts
// the Imports holding or waiting for a Title, so a Move can refuse instead of
// queueing behind one.
type titleGuard struct {
	mu   sync.Mutex
	held map[int64]*titleLock
}

type titleLock struct {
	sync.Mutex
	users   int // holders and waiters
	imports int // Imports among them
}

// The ways to take a Title's lock.
const (
	forImport = iota
	forRename
	forMove // refused while an Import holds or waits for the lock
)

// lock takes the Title's lock, waiting for whoever holds it, and returns its
// release. For a Move it returns false, without waiting, when an Import holds
// or waits for the lock.
func (g *titleGuard) lock(titleID int64, what int) (func(), bool) {
	g.mu.Lock()
	if g.held == nil {
		g.held = map[int64]*titleLock{}
	}
	l := g.held[titleID]
	if l == nil {
		l = &titleLock{}
		g.held[titleID] = l
	}
	if what == forMove && l.imports > 0 {
		g.mu.Unlock()
		return nil, false
	}
	l.users++
	if what == forImport {
		l.imports++
	}
	g.mu.Unlock()
	l.Lock()
	return func() {
		l.Unlock()
		g.mu.Lock()
		l.users--
		if what == forImport {
			l.imports--
		}
		if l.users == 0 {
			delete(g.held, titleID)
		}
		g.mu.Unlock()
	}, true
}
