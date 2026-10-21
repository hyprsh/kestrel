package api_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/jobs"
)

type jobJSON struct {
	Name     string `json:"name"`
	Status   string `json:"status"`
	Runnable bool   `json:"runnable"`
	LastRun  *struct {
		StartedAt  time.Time `json:"started_at"`
		FinishedAt time.Time `json:"finished_at"`
		DurationMs int64     `json:"duration_ms"`
		Error      *string   `json:"error"`
	} `json:"last_run"`
	NextAt *time.Time `json:"next_at"`
}

func (s search) jobList(t *testing.T) map[string]jobJSON {
	t.Helper()
	r := s.valid("GET", "/jobs", "")
	if r.Status != 200 {
		t.Fatalf("GET /jobs = %d %s", r.Status, r.Body)
	}
	out := map[string]jobJSON{}
	for _, j := range decode[struct {
		Items []jobJSON `json:"items"`
	}](t, r).Items {
		out[j.Name] = j
	}
	return out
}

func TestTheJobsListEveryLoopWithItsLastRun(t *testing.T) {
	t.Parallel()
	s := newSearch(t)

	before := s.jobList(t)
	for _, name := range []string{jobs.Poll, jobs.Search, jobs.Import, jobs.Prune, jobs.Health, jobs.Refresh, jobs.Updates, jobs.RSS} {
		j, ok := before[name]
		if !ok {
			t.Fatalf("jobs = %v, want %s listed", before, name)
		}
		if j.Status != "idle" || j.LastRun != nil || j.NextAt != nil {
			t.Errorf("%s before any pass = %+v, want idle and not run since start", name, j)
		}
	}
	for name, j := range before {
		want := name == jobs.Search || name == jobs.RSS || name == jobs.Refresh || name == jobs.Health
		if j.Runnable != want {
			t.Errorf("%s runnable = %v, want %v", name, j.Runnable, want)
		}
	}

	s.in.clock.Advance(time.Minute)
	s.pass(t, jobs.Search)

	j := s.jobList(t)[jobs.Search]
	if j.LastRun == nil || !j.LastRun.FinishedAt.Equal(s.in.clock.Now()) || j.LastRun.Error != nil || j.LastRun.DurationMs != 0 {
		t.Errorf("search after a pass = %+v, want it finished now without an error", j.LastRun)
	}
}

func TestTheUpdatesJobIsDisabledWhenGitHubIsNotChecked(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	if r := s.valid("PATCH", "/settings", `{"check_github_updates":false}`); r.Status != 200 {
		t.Fatalf("PATCH /settings = %d %s", r.Status, r.Body)
	}

	if j := s.jobList(t)[jobs.Updates]; j.Status != "disabled" {
		t.Errorf("updates = %+v, want disabled", j)
	}
}

func TestRunNowKicksOnlyTheLoopsSafeToRunByHand(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.in.app.Jobs.Run(ctx)
	ran := func(name string, at time.Time) func() bool {
		return func() bool { j := s.jobList(t)[name]; return j.LastRun != nil && j.LastRun.FinishedAt.Equal(at) }
	}
	eventually(t, "the first RSS pass", ran(jobs.RSS, s.in.clock.Now()))

	s.in.clock.Advance(time.Minute)
	if r := s.valid("POST", "/jobs/rss/run", ""); r.Status != 202 {
		t.Fatalf("POST /jobs/rss/run = %d %s", r.Status, r.Body)
	}
	eventually(t, "the kicked RSS pass", ran(jobs.RSS, s.in.clock.Now()))

	if r := s.valid("POST", "/jobs/poll/run", ""); r.Status != 409 || !strings.Contains(r.Body, `"code":"not_runnable"`) {
		t.Errorf("POST /jobs/poll/run = %d %s, want 409 not_runnable", r.Status, r.Body)
	}
	if r := s.valid("POST", "/jobs/nope/run", ""); r.Status != 404 || !strings.Contains(r.Body, `"code":"not_found"`) {
		t.Errorf("POST /jobs/nope/run = %d %s, want 404", r.Status, r.Body)
	}
}

func TestTheStreamSendsTheJobsWhenTheyChange(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t, fastStream)
	st := s.stream(t)
	st.until("a jobs frame", func(e sseEvent) bool { return e.Name == "jobs" })

	st.mark()
	s.pass(t, jobs.Health)

	st.until("a jobs frame with the health pass", func(e sseEvent) bool {
		var v struct {
			Items []jobJSON `json:"items"`
		}
		if e.Name != "jobs" || json.Unmarshal([]byte(e.Data), &v) != nil {
			return false
		}
		for _, j := range v.Items {
			if j.Name == jobs.Health && j.LastRun != nil {
				return true
			}
		}
		return false
	})
}
