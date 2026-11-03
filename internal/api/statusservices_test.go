package api_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/health"
	"github.com/hyprsh/kestrel/internal/jobs"
)

type servicesJSON struct {
	Version   string    `json:"version"`
	StartedAt time.Time `json:"started_at"`
	Services  []struct {
		Kind       string     `json:"kind"`
		Name       string     `json:"name"`
		InstanceID *int64     `json:"instance_id"`
		State      string     `json:"state"`
		Message    *string    `json:"message"`
		Since      *time.Time `json:"since"`
	} `json:"services"`
}

func TestTheSystemStatusSaysTheVersionWhenItStartedAndEachMediaServer(t *testing.T) {
	t.Parallel()
	s, _ := newMediaSearch(t)

	st := decode[servicesJSON](t, s.valid("GET", "/system/status", ""))
	if st.Version == "" || st.StartedAt.IsZero() {
		t.Errorf("version %q, started %v, want both", st.Version, st.StartedAt)
	}
	// The metadata providers come first, then the media servers.
	if len(st.Services) != 3 || st.Services[0].Name != "TMDB" || st.Services[1].Name != "TheTVDB" || st.Services[0].Kind != "metadata_provider" {
		t.Fatalf("services = %+v, want TMDB and TheTVDB, then Plex", st.Services)
	}
	if p := st.Services[2]; p.Kind != "media_server" || p.Name != "Plex" || p.State != "ok" || p.Message != nil || p.Since != nil || p.InstanceID == nil {
		t.Fatalf("services[2] = %+v, want a Plex media server that is ok", p)
	}

	id := *st.Services[2].InstanceID
	if err := s.in.app.Health.Raise(jobCtx(), health.Issue{
		Key: fmt.Sprintf("media_server:%d", id), Kind: health.KindMediaServer, Severity: health.Warning,
		Subject: health.Subject{PluginInstanceID: id}, Message: "Plex is unreachable: connection refused",
	}); err != nil {
		t.Fatal(err)
	}
	got := decode[servicesJSON](t, s.valid("GET", "/system/status", "")).Services[2]
	if got.State != "failing" || got.Message == nil || *got.Message != "Plex is unreachable: connection refused" || got.Since == nil {
		t.Errorf("service with a row = %+v, want failing with its message and since", got)
	}
}

func TestTheJobsListTheirRecentRunsOldestFirst(t *testing.T) {
	t.Parallel()
	s := newSearch(t)
	for range 12 {
		s.in.clock.Advance(time.Minute)
		s.pass(t, jobs.Search)
	}
	runs := decode[struct {
		Items []struct {
			Name       string `json:"name"`
			RecentRuns []struct {
				StartedAt time.Time `json:"started_at"`
				Error     *string   `json:"error"`
			} `json:"recent_runs"`
		} `json:"items"`
	}](t, s.valid("GET", "/jobs", ""))
	for _, j := range runs.Items {
		switch {
		case j.Name == jobs.Search && len(j.RecentRuns) != jobs.RecentPasses:
			t.Errorf("search has %d recent runs, want %d", len(j.RecentRuns), jobs.RecentPasses)
		case j.Name == jobs.Search && !j.RecentRuns[0].StartedAt.Before(j.RecentRuns[len(j.RecentRuns)-1].StartedAt):
			t.Errorf("search runs are not oldest first: %+v", j.RecentRuns)
		case j.Name == jobs.Prune && j.RecentRuns == nil:
			t.Errorf("a job that has not run lists an empty array, not null")
		}
	}
}
