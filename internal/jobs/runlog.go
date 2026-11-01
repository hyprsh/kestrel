package jobs

import (
	"context"
	"time"

	"github.com/hyprsh/kestrel/internal/jobs/db"
	"github.com/hyprsh/kestrel/internal/store"
)

// RunLog keeps each loop's last RecentPasses passes across restarts, for the Health
// screen's "Last 10" bars. The runner loads it once when it starts and saves every
// pass that finishes; a failure to save is logged and loses only that bar.
type RunLog interface {
	// Load returns the passes kept per loop, oldest first.
	Load(ctx context.Context) (map[string][]PassResult, error)
	// Save adds a pass of a loop and drops all but its newest RecentPasses.
	Save(ctx context.Context, name string, p PassResult) error
}

// StoreRunLog is the RunLog in the database's job_runs table.
type StoreRunLog struct{ st *store.Store }

// NewStoreRunLog returns the RunLog over st.
func NewStoreRunLog(st *store.Store) *StoreRunLog { return &StoreRunLog{st: st} }

func stampOf(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }

func (l *StoreRunLog) Load(ctx context.Context) (map[string][]PassResult, error) {
	rows, err := db.New(l.st.Read()).ListJobRuns(ctx)
	if err != nil {
		return nil, err
	}
	out := map[string][]PassResult{}
	for _, r := range rows {
		started, _ := time.Parse(time.RFC3339Nano, r.StartedAt)
		finished, _ := time.Parse(time.RFC3339Nano, r.FinishedAt)
		out[r.Name] = append(out[r.Name], PassResult{
			StartedAt: started, FinishedAt: finished, Took: time.Duration(r.TookMs) * time.Millisecond, Err: r.Err,
		})
	}
	for name, runs := range out {
		if n := len(runs); n > RecentPasses {
			out[name] = runs[n-RecentPasses:]
		}
	}
	return out, nil
}

func (l *StoreRunLog) Save(ctx context.Context, name string, p PassResult) error {
	q := db.New(l.st.Write())
	err := q.InsertJobRun(ctx, db.InsertJobRunParams{
		Name: name, StartedAt: stampOf(p.StartedAt), FinishedAt: stampOf(p.FinishedAt), TookMs: p.Took.Milliseconds(), Err: p.Err,
	})
	if err != nil {
		return err
	}
	return q.PruneJobRuns(ctx, db.PruneJobRunsParams{Job: name, Keep: RecentPasses})
}
