package store

// BetweenHookAndVisible sets fn to run inside the commit hook of a write: the counters are bumped, the commit is not yet
// visible to other connections.
func (s *Store) BetweenHookAndVisible(fn func()) {
	s.gen.mu.Lock()
	s.gen.betweenHookAndVisible = fn
	s.gen.mu.Unlock()
}
