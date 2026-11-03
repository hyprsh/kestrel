package store

import (
	"context"
	"database/sql/driver"
	"sync"

	"modernc.org/sqlite"
)

// generations counts, per table, the commits that wrote to it, so a cache of what some tables hold can outlive writes
// to the others. The write connection's hooks feed it: the pre-update hook notes each table a transaction touches, the
// commit hook bumps those tables' counters, the rollback hook forgets them.
//
// A write the hooks never saw (another process on the file, the sqlite3 CLI) shows as a change of PRAGMA data_version
// that no hooked commit accounts for; observe then bumps every table at once.
type generations struct {
	mu      sync.Mutex
	touched map[string]struct{} // tables the open transaction wrote to
	tables  map[string]uint64   // commits per table
	epoch   uint64              // writes from outside, which touch every table
	noted   uint64              // commits the hooks have seen

	// betweenHookAndVisible runs in the commit hook, after the bump and before the commit is visible. Tests only.
	betweenHookAndVisible func()

	seen      bool
	seenData  int64  // data_version at the last observation
	seenNoted uint64 // noted at the last observation
}

func newGenerations() *generations {
	return &generations{touched: map[string]struct{}{}, tables: map[string]uint64{}}
}

func (g *generations) preUpdate(d sqlite.SQLitePreUpdateData) {
	g.mu.Lock()
	g.touched[d.TableName] = struct{}{}
	g.mu.Unlock()
}

func (g *generations) commit() int32 {
	g.mu.Lock()
	if len(g.touched) == 0 { // a transaction that wrote nothing
		g.mu.Unlock()
		return 0
	}
	for t := range g.touched {
		g.tables[t]++
	}
	clear(g.touched)
	g.noted++
	between := g.betweenHookAndVisible
	g.mu.Unlock()
	// SQLite runs this hook before the commit is visible to other connections. A reader that stamps its read with
	// the bumped counters now builds on the old data; observe catches that, because data_version then moves later
	// with no hooked commit to explain it, and the next stamp differs.
	if between != nil {
		between()
	}
	return 0 // let the commit go ahead
}

func (g *generations) rollback() {
	g.mu.Lock()
	clear(g.touched)
	g.mu.Unlock()
}

// observe takes the database's data_version and, when it moved with no hooked commit since the last observation, counts
// a write from outside. A commit is noted by its hook just before it is visible to other connections, so an
// observation can catch the one without the other; the next one then reads a change nothing accounts for and drops
// everything once, which only costs a rebuild.
func (g *generations) observe(data int64) {
	if !g.seen {
		g.seen, g.seenData, g.seenNoted = true, data, g.noted
		return
	}
	if data != g.seenData && g.noted == g.seenNoted {
		g.epoch++
	}
	g.seenData, g.seenNoted = data, g.noted
}

// hooked is a connector that registers the generation hooks on every connection it opens.
type hooked struct {
	driver.Connector
	g *generations
}

func (h hooked) Connect(ctx context.Context) (driver.Conn, error) {
	c, err := h.Connector.Connect(ctx)
	if err != nil {
		return nil, err
	}
	if r, ok := c.(sqlite.HookRegisterer); ok {
		r.RegisterPreUpdateHook(h.g.preUpdate)
		r.RegisterCommitHook(h.g.commit)
		r.RegisterRollbackHook(h.g.rollback)
	}
	return c, nil
}

// Generation is a number that changes whenever a commit wrote to any of tables (or the database changed behind this
// store's back), and otherwise stays the same. A cache of what a read of those tables computes is good for as long as
// it does. Read it before the read it stamps: a commit during that read makes the next call differ.
//
// Writes through Write() are noted by their hooks, per table. DataVersion remains the fallback for everything else; a
// write from outside that lands in the same moment as one of ours, between two calls, goes unnoticed.
func (s *Store) Generation(ctx context.Context, tables ...string) (uint64, error) {
	data, err := s.DataVersion(ctx)
	if err != nil {
		return 0, err
	}
	g := s.gen
	g.mu.Lock()
	defer g.mu.Unlock()
	g.observe(data)
	sum := g.epoch
	for _, t := range tables {
		sum += g.tables[t]
	}
	return sum, nil
}
