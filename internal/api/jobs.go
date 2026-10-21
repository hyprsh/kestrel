package api

import (
	"context"
	"net/http"
	"slices"

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
		switch {
		case j.Running:
			row.Status = oapi.JobStatusRunning
		case s.disabled(ctx, j.Name):
			row.Status = oapi.JobStatusDisabled
		}
		if p := j.Last; p != nil {
			row.LastRun = &oapi.JobRun{StartedAt: p.StartedAt, FinishedAt: p.FinishedAt, DurationMs: p.Took.Milliseconds()}
			if p.Err != "" {
				row.LastRun.Error = &p.Err
			}
		}
		if !j.Next.IsZero() {
			row.NextAt = &j.Next
		}
		out.Items = append(out.Items, row)
	}
	return out
}

// disabled says whether a setting turns a loop's work off: it still checks
// hourly, but does nothing.
func (s *server) disabled(ctx context.Context, name string) bool {
	switch name {
	case jobs.Updates:
		return !s.updates.Enabled(ctx)
	case jobs.Trash:
		on, err := s.trash.AutoUpdate(ctx)
		return err == nil && !on
	}
	return false
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
