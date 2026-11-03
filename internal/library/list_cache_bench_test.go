package library_test

import (
	"context"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/slot"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/store/storetest"
)

// BenchmarkListBusy reads the list after every write of a busy install's background traffic (Log entries, Health issues,
// job runs) and reports how many reads had to build it: `go test ./internal/library -run '^$' -bench ListBusy`.
func BenchmarkListBusy(b *testing.B) {
	ctx := context.Background()
	st, err := store.Open(ctx, store.Options{Dir: storetest.Dir(b)})
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { st.Close() })
	lib := library.New(st, func() time.Time { return now })
	if _, err := lib.AddMovie(ctx, library.AddMovie{
		Details: paddington(), PrimaryLanguage: "de", RootFolder: "/data/media/movies",
		Versions: []library.VersionSpec{{Slot: slot.Standard, Profile: "hd-primary"}},
	}); err != nil {
		b.Fatal(err)
	}
	at := now.Format("2006-01-02T15:04:05Z")
	writes := []string{
		`INSERT INTO events (at, kind, routine, message) VALUES ('` + at + `', 'bench', 1, 'tick')`,
		`INSERT INTO health_issues (key, kind, severity, message, first_at, last_at) VALUES ('bench', 'bench', 'warning', 'm', '` + at + `', '` + at + `')
			ON CONFLICT (key) DO UPDATE SET count = count + 1, last_at = excluded.last_at`,
		`INSERT INTO job_runs (name, started_at, finished_at, took_ms) VALUES ('bench', '` + at + `', '` + at + `', 1)`,
	}
	view := library.View{Country: "DE", Now: now}
	if _, err := lib.List(ctx, view, library.Filter{}); err != nil {
		b.Fatal(err)
	}
	builds := lib.ListBuilds()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := st.Write().ExecContext(ctx, writes[i%len(writes)]); err != nil {
			b.Fatal(err)
		}
		if _, err := lib.List(ctx, view, library.Filter{}); err != nil {
			b.Fatal(err)
		}
	}
	b.ReportMetric(float64(lib.ListBuilds()-builds)/float64(b.N), "misses/read")
}
