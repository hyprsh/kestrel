package api

import (
	"context"
	"net/http"
	"slices"
	"time"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/jobs"
)

// byHand are the loops "Run now" may kick. The others either follow their own
// trigger (Poll after a Grab, Import after a download finishes), touch nothing
// a person waits on (Prune) or are daily checks that a kick would only find not
// due yet (Trash, Updates).
var byHand = []string{jobs.Search, jobs.RSS, jobs.Refresh, jobs.Health}

func (s *server) ListJobs(ctx context.Context, _ oapi.ListJobsRequestObject) (oapi.ListJobsResponseObject, error) {
	return oapi.ListJobs200JSONResponse(s.jobList(ctx)), nil
}

// jobList is the runner's loops with what turns their work off. It is all in
// memory but for two settings reads, so the stream can send it every tick.
func (s *server) jobList(ctx context.Context) oapi.JobList {
	out := oapi.JobList{Items: []oapi.Job{}}
	for _, j := range s.jobs.Jobs() {
		row := oapi.Job{Name: j.Name, Status: oapi.JobStatusIdle, Runnable: slices.Contains(byHand, j.Name)}
		switch by := s.disabledBy(ctx, j.Name); {
		case j.Running:
			row.Status = oapi.JobStatusRunning
		case by != nil:
			row.Status, row.DisabledBy = oapi.JobStatusDisabled, by
		}
		if p := j.Last; p != nil {
			row.LastRun = &oapi.JobRun{StartedAt: p.StartedAt, FinishedAt: p.FinishedAt, DurationMs: p.Took.Milliseconds()}
			if p.Err != "" {
				row.LastRun.Error = &p.Err
			}
		}
		if p := j.Progress; p != nil {
			row.Progress = &oapi.JobProgress{Done: p.Done, Total: p.Total}
		}
		if o := j.Outcome; o != nil {
			row.Outcome = &oapi.JobOutcome{Kind: oapi.JobOutcomeKind(o.Kind), Text: o.Text, At: o.At}
		}
		if !j.Next.IsZero() {
			row.NextAt = &j.Next
		}
		row.Schedule.EveryMs = j.Schedule.Every.Milliseconds()
		row.Schedule.BusyEveryMs = msPtr(j.Schedule.Busy)
		row.Schedule.RunsEveryMs = msPtr(j.Schedule.Runs)
		out.Items = append(out.Items, row)
	}
	return out
}

// msPtr is d in milliseconds, nil for none.
func msPtr(d time.Duration) *int64 {
	if d == 0 {
		return nil
	}
	ms := d.Milliseconds()
	return &ms
}

// disabledBy is the setting that turns a loop's work off, nil while none
// does: the loop still checks hourly, but does nothing. The daily TRaSH check
// asks GitHub too, so the GitHub switch turns it off before its own does.
func (s *server) disabledBy(ctx context.Context, name string) *oapi.JobDisabledBy {
	by := func(v oapi.JobDisabledBy) *oapi.JobDisabledBy { return &v }
	switch name {
	case jobs.Updates:
		if !s.updates.Enabled(ctx) {
			return by(oapi.GithubCheck)
		}
	case jobs.Trash:
		if !s.updates.Enabled(ctx) {
			return by(oapi.GithubCheck)
		}
		if on, err := s.trash.AutoUpdate(ctx); err == nil && !on {
			return by(oapi.TrashAutoUpdate)
		}
	case jobs.Watchlist:
		if sw, err := LoadPlexSwitches(ctx, s.plex.settings); err == nil && !sw.Watchlist {
			return by(oapi.PlexWatchlist)
		}
	}
	return nil
}

func (s *server) RunJob(_ context.Context, r oapi.RunJobRequestObject) (oapi.RunJobResponseObject, error) {
	if !slices.ContainsFunc(s.jobs.Jobs(), func(j jobs.Job) bool { return j.Name == r.Name }) {
		return nil, problem(http.StatusNotFound, "not_found", "no such background job")
	}
	if !slices.Contains(byHand, r.Name) {
		return nil, problem(http.StatusConflict, "not_runnable", "this background job runs on its own schedule only")
	}
	s.jobs.Kick(r.Name)
	return oapi.RunJob202Response{}, nil
}
