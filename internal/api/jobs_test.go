package api_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/app"
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
	NextAt     *time.Time `json:"next_at"`
	DisabledBy *string    `json:"disabled_by"`
	Schedule   struct {
		EveryMs     int64  `json:"every_ms"`
		BusyEveryMs *int64 `json:"busy_every_ms"`
		RunsEveryMs *int64 `json:"runs_every_ms"`
	} `json:"schedule"`
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

func TestTheJobsSayHowOftenEachLoopRuns(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	ms := func(d time.Duration) *int64 { v := d.Milliseconds(); return &v }
	list := s.jobList(t)
	for name, want := range map[string]struct {
		every      time.Duration
		busy, runs *int64
	}{
		jobs.Poll:    {5 * time.Minute, ms(10 * time.Second), nil},
		jobs.Search:  {5 * time.Minute, nil, nil},
		jobs.Import:  {time.Minute, nil, nil},
		jobs.RSS:     {15 * time.Minute, nil, nil},
		jobs.Health:  {5 * time.Minute, nil, nil},
		jobs.Prune:   {time.Hour, nil, ms(24 * time.Hour)},
		jobs.Refresh: {time.Hour, nil, ms(24 * time.Hour)},
		jobs.Updates: {time.Hour, nil, ms(24 * time.Hour)},
	} {
		got := list[name].Schedule
		eq := func(a, b *int64) bool { return a == nil && b == nil || a != nil && b != nil && *a == *b }
		if got.EveryMs != want.every.Milliseconds() || !eq(got.BusyEveryMs, want.busy) || !eq(got.RunsEveryMs, want.runs) {
			t.Errorf("%s schedule = %+v, want every %v, busy %v, runs %v", name, got, want.every, want.busy, want.runs)
		}
	}
}

func TestTheUpdatesJobIsDisabledWhenGitHubIsNotChecked(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	if r := s.valid("PATCH", "/settings", `{"check_github_updates":false}`); r.Status != 200 {
		t.Fatalf("PATCH /settings = %d %s", r.Status, r.Body)
	}

	if j := s.jobList(t)[jobs.Updates]; j.Status != "disabled" || j.DisabledBy == nil || *j.DisabledBy != "github_check" {
		t.Errorf("updates = %+v, want disabled by the GitHub check", j)
	}
}

func TestTheTrashJobSaysWhichSwitchTurnsItOff(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t, func(o *app.Options) { o.TrashSource = &trashSource{} })
	patch := func(body string) {
		t.Helper()
		if r := s.valid("PATCH", "/settings", body); r.Status != 200 {
			t.Fatalf("PATCH /settings %s = %d %s", body, r.Status, r.Body)
		}
	}
	by := func() string {
		t.Helper()
		j := s.jobList(t)[jobs.Trash]
		if j.DisabledBy == nil {
			return j.Status
		}
		return j.Status + " by " + *j.DisabledBy
	}

	if got := by(); got != "idle" {
		t.Errorf("trash with both switches on = %s, want idle", got)
	}
	patch(`{"trash":{"auto_update":false}}`)
	if got := by(); got != "disabled by trash_auto_update" {
		t.Errorf("trash without auto-update = %s, want disabled by trash_auto_update", got)
	}
	// The daily TRaSH check asks GitHub too, so the GitHub switch turns it off first.
	patch(`{"trash":{"auto_update":true},"check_github_updates":false}`)
	if got := by(); got != "disabled by github_check" {
		t.Errorf("trash without the GitHub check = %s, want disabled by github_check", got)
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
