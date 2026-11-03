package store_test

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"

	"github.com/hyprsh/kestrel/internal/store"
)

func stamp(t *testing.T, s *store.Store, tables ...string) uint64 {
	t.Helper()
	g, err := s.Generation(context.Background(), tables...)
	if err != nil {
		t.Fatal(err)
	}
	return g
}

func TestGenerationMovesOnlyWithItsTables(t *testing.T) {
	s := mustOpen(t, t.TempDir(), 2)
	ctx := context.Background()
	w := s.Write()
	one := stamp(t, s, "t1")
	two := stamp(t, s, "t2")

	if _, err := w.ExecContext(ctx, "INSERT INTO t2 (id) VALUES (1)"); err != nil {
		t.Fatal(err)
	}
	if got := stamp(t, s, "t1"); got != one {
		t.Errorf("a write to t2 moved t1's generation: %d -> %d", one, got)
	}
	if got := stamp(t, s, "t2"); got == two {
		t.Error("a write to t2 left its generation alone")
	}
	if got := stamp(t, s, "t1", "t2"); got == one+two {
		t.Error("a write to t2 left the generation of t1 and t2 together alone")
	}

	one = stamp(t, s, "t1")
	two = stamp(t, s, "t2")
	if _, err := w.ExecContext(ctx, "INSERT INTO t1 (id) VALUES (1)"); err != nil {
		t.Fatal(err)
	}
	if got := stamp(t, s, "t1"); got == one {
		t.Error("a write to t1 left its generation alone")
	}
	if got := stamp(t, s, "t2"); got != two {
		t.Error("a write to t1 moved t2's generation")
	}
}

func TestGenerationIgnoresRollbackAndEmptyCommits(t *testing.T) {
	s := mustOpen(t, t.TempDir(), 1)
	ctx := context.Background()
	before := stamp(t, s, "t1")

	tx, err := s.Write().BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO t1 (id) VALUES (1)"); err != nil {
		t.Fatal(err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if got := stamp(t, s, "t1"); got != before {
		t.Errorf("a rolled back write moved the generation: %d -> %d", before, got)
	}

	// The rolled back touch must not leak into the next transaction's commit.
	tx, err = s.Write().BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(ctx, "SELECT 1"); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if got := stamp(t, s, "t1"); got != before {
		t.Error("an empty commit moved the generation")
	}
}

func TestGenerationMovesOnCommitOfTransaction(t *testing.T) {
	s := mustOpen(t, t.TempDir(), 1)
	ctx := context.Background()
	before := stamp(t, s, "t1")
	tx, err := s.Write().BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{"INSERT INTO t1 (id) VALUES (1)", "INSERT INTO t1 (id) VALUES (2)"} {
		if _, err := tx.ExecContext(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if got := stamp(t, s, "t1"); got == before {
		t.Error("a committed transaction left the generation alone")
	}
}

// SQLite runs the commit hook before the commit is visible. A reader that takes the generation in that gap and then
// reads the old data must not be able to keep it: the generation after the commit has to differ from the one it took.
func TestGenerationTakenBeforeACommitIsVisibleIsNotTheOneAfter(t *testing.T) {
	s := mustOpen(t, t.TempDir(), 1)
	ctx := context.Background()
	stamp(t, s, "t1") // a first observation, as any running server has made

	var during uint64
	var seen int
	s.BetweenHookAndVisible(func() {
		during = stamp(t, s, "t1")
		if err := s.Read().QueryRowContext(ctx, "SELECT count(*) FROM t1").Scan(&seen); err != nil {
			t.Error(err)
		}
	})
	if _, err := s.Write().ExecContext(ctx, "INSERT INTO t1 (id) VALUES (1)"); err != nil {
		t.Fatal(err)
	}
	s.BetweenHookAndVisible(nil)

	if seen != 0 {
		t.Fatalf("the reader saw %d rows inside the commit; the test no longer reproduces the gap", seen)
	}
	if after := stamp(t, s, "t1"); after == during {
		t.Errorf("generation %d taken before the commit was visible is still current after it", during)
	}
}

// The same gap, but a second commit to an unrelated table lands before the next stamp, so that data_version and the
// hooks' count both moved and the change looks explained.
func TestGenerationTakenInACommitGapSurvivesALaterUnrelatedCommit(t *testing.T) {
	s := mustOpen(t, t.TempDir(), 2)
	ctx := context.Background()
	stamp(t, s, "t1")

	var during uint64
	s.BetweenHookAndVisible(func() { during = stamp(t, s, "t1") })
	if _, err := s.Write().ExecContext(ctx, "INSERT INTO t1 (id) VALUES (1)"); err != nil { // A: visible now
		t.Fatal(err)
	}
	s.BetweenHookAndVisible(nil)
	if _, err := s.Write().ExecContext(ctx, "INSERT INTO t2 (id) VALUES (1)"); err != nil { // B: unrelated
		t.Fatal(err)
	}
	if after := stamp(t, s, "t1"); after == during {
		t.Errorf("generation %d taken before commit A was visible is still current after A and B", during)
	}
}

// A write the hooks never saw (another process) moves every generation.
func TestGenerationMovesOnWriteFromOutside(t *testing.T) {
	dir := t.TempDir()
	s := mustOpen(t, dir, 2)
	ctx := context.Background()
	before := stamp(t, s, "t1")

	other, err := sql.Open("sqlite", "file:"+filepath.Join(dir, "kestrel.db")+"?_pragma=busy_timeout(5000)")
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	if _, err := other.ExecContext(ctx, "INSERT INTO t2 (id) VALUES (1)"); err != nil {
		t.Fatal(err)
	}
	if got := stamp(t, s, "t1"); got == before {
		t.Error("a write from outside the store left an unrelated generation alone")
	}
	// A write of ours afterwards is explained again.
	settled := stamp(t, s, "t1")
	if _, err := s.Write().ExecContext(ctx, "INSERT INTO t2 (id) VALUES (2)"); err != nil {
		t.Fatal(err)
	}
	if got := stamp(t, s, "t1"); got != settled {
		t.Error("an own write to t2 moved t1 after the outside write was accounted for")
	}
}
