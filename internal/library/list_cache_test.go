package library_test

import (
	"context"
	"slices"
	"sort"
	"testing"

	"github.com/hyprsh/kestrel/internal/library"
)

func listRows(t *testing.T, lib *library.Service) []library.Row {
	t.Helper()
	rows, err := lib.List(context.Background(), library.View{Country: "DE", Now: now}, library.Filter{})
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func TestTheListCacheSurvivesWritesToTablesTheListDoesNotRead(t *testing.T) {
	ctx := context.Background()
	lib, st := newLibrary(t)
	addPaddington(t, lib)
	listRows(t, lib)
	builds := lib.ListBuilds()

	for _, q := range []string{
		`INSERT INTO health_issues (key, kind, severity, message, first_at, last_at) VALUES ('k', 'k', 'warning', 'm', '2026-10-17T12:00:00Z', '2026-10-17T12:00:00Z')`,
		`INSERT INTO job_runs (name, started_at, finished_at, took_ms) VALUES ('j', '2026-10-17T12:00:00Z', '2026-10-17T12:00:01Z', 1000)`,
	} {
		if _, err := st.Write().ExecContext(ctx, q); err != nil {
			t.Fatal(err)
		}
		listRows(t, lib)
	}
	if got := lib.ListBuilds(); got != builds {
		t.Errorf("the list was built %d more times after writes it does not read", got-builds)
	}
}

func TestTheListCacheDropsWhenAWriteChangesARow(t *testing.T) {
	ctx := context.Background()
	lib, _ := newLibrary(t)
	id := addPaddington(t, lib)
	if rows := listRows(t, lib); !rows[0].Monitored {
		t.Fatalf("row = %+v", rows[0])
	}
	builds := lib.ListBuilds()

	if _, err := lib.SetMonitored(ctx, []int64{id}, false, ""); err != nil {
		t.Fatal(err)
	}
	if rows := listRows(t, lib); rows[0].Monitored {
		t.Errorf("the list still shows the Title monitored: %+v", rows[0])
	}
	if got := lib.ListBuilds(); got != builds+1 {
		t.Errorf("builds = %d, want %d", got, builds+1)
	}
}

// listTables must name every table the list's queries read: a table missing from it would let a stale list outlive a
// write that changes it.
func TestTheListTablesAreTheTablesTheListQueriesRead(t *testing.T) {
	ctx := context.Background()
	lib, st := newLibrary(t)
	addPaddington(t, lib)
	queries, err := lib.ListQueries(ctx, library.View{Country: "DE", Now: now})
	if err != nil {
		t.Fatal(err)
	}
	if len(queries) == 0 {
		t.Fatal("the list ran no queries")
	}

	// EXPLAIN lists the b-trees a statement opens; sqlite_master maps their root pages to tables.
	roots := map[int64]string{}
	rows, err := st.Read().QueryContext(ctx, `SELECT rootpage, tbl_name FROM sqlite_master WHERE rootpage > 0`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var root int64
		var name string
		if err := rows.Scan(&root, &name); err != nil {
			t.Fatal(err)
		}
		roots[root] = name
	}
	rows.Close()

	read := map[string]bool{}
	for _, q := range queries {
		ops, err := st.Read().QueryContext(ctx, "EXPLAIN "+q)
		if err != nil {
			t.Fatalf("explain %q: %v", q, err)
		}
		for ops.Next() {
			var addr, p1, p2, p3 int64
			var opcode string
			var p4, p5, comment any
			if err := ops.Scan(&addr, &opcode, &p1, &p2, &p3, &p4, &p5, &comment); err != nil {
				t.Fatal(err)
			}
			if opcode == "OpenRead" {
				if name, ok := roots[p2]; ok {
					read[name] = true
				}
			}
		}
		ops.Close()
	}
	var got []string
	for name := range read {
		got = append(got, name)
	}
	sort.Strings(got)
	want := slices.Clone(library.ListTables())
	sort.Strings(want)
	if !slices.Equal(got, want) {
		t.Errorf("the list queries read %v, but listTables names %v", got, want)
	}
}
