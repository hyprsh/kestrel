package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/hyprsh/kestrel/internal/api"
	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/settings"
)

const fakeAdvisory = `[{"ghsa_id":"GHSA-xxxx-yyyy-zzzz","summary":"x","state":"published","vulnerabilities":[{"vulnerable_version_range":">= 1.0.0, < 1.2.4","first_patched_version":"1.2.4"}]}]`

// fakeGitHubAPI serves a newer release and an advisory covering the test
// instance's version (1.2.3).
func fakeGitHubAPI(t *testing.T, calls *atomic.Int32) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		switch r.URL.Path {
		case "/repos/hyprsh/kestrel/releases/latest":
			w.Write([]byte(`{"tag_name":"v1.2.4","html_url":"https://github.com/hyprsh/kestrel/releases/tag/v1.2.4"}`))
		case "/repos/hyprsh/kestrel/security-advisories":
			w.Write([]byte(fakeAdvisory))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestTheDailyCheckRaisesTheSecurityWarningAndShowsTheUpdate(t *testing.T) {
	var calls atomic.Int32
	gh := fakeGitHubAPI(t, &calls)
	in := newInstance(t, "", func(o *api.Options) { o.GitHubAPI = gh.URL })
	b := in.setUp()
	if err := settings.New(in.st).Put(context.Background(), "setup_completed", []byte("true")); err != nil {
		t.Fatal(err)
	}

	if err := in.app.Jobs.Pass(context.Background(), jobs.Updates); err != nil {
		t.Fatal(err)
	}

	var att attentionJSON
	if err := json.Unmarshal([]byte(b.get("/attention").Body), &att); err != nil {
		t.Fatal(err)
	}
	row := att.row(t, "security_fix_available")
	if row.Severity != "warning" || !strings.Contains(row.Message, "GHSA-xxxx-yyyy-zzzz") || !strings.Contains(row.Message, "1.2.4") {
		t.Fatalf("row = %+v", row)
	}

	var status struct {
		Update *struct{ Version, URL string } `json:"update"`
	}
	json.Unmarshal([]byte(b.get("/system/status").Body), &status)
	if status.Update == nil || status.Update.Version != "1.2.4" {
		t.Fatalf("health strip update = %+v", status.Update)
	}

	var about struct {
		Version     string  `json:"version"`
		License     string  `json:"license"`
		TrashCommit string  `json:"trash_commit"`
		CheckedAt   *string `json:"checked_at"`
		Update      *struct{ Version string }
	}
	json.Unmarshal([]byte(b.get("/about").Body), &about)
	if about.Version != "1.2.3" || about.License != "GPL-3.0-only" || len(about.TrashCommit) != 40 || about.CheckedAt == nil || about.Update == nil {
		t.Fatalf("about = %+v", about)
	}
}

func TestTurningTheSwitchOffClearsWhatGitHubShowedAndStopsAsking(t *testing.T) {
	var calls atomic.Int32
	gh := fakeGitHubAPI(t, &calls)
	in := newInstance(t, "", func(o *api.Options) { o.GitHubAPI = gh.URL })
	b := in.setUp()
	if err := settings.New(in.st).Put(context.Background(), "setup_completed", []byte("true")); err != nil {
		t.Fatal(err)
	}
	if err := in.app.Jobs.Pass(context.Background(), jobs.Updates); err != nil {
		t.Fatal(err)
	}

	if r := b.do("PATCH", "/settings", `{"check_github_updates":false}`); r.Status != 200 || !strings.Contains(r.Body, `"check_github_updates":false`) {
		t.Fatalf("patch = %d %s", r.Status, r.Body)
	}
	asked := calls.Load()
	if err := in.app.Jobs.Pass(context.Background(), jobs.Updates); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != asked {
		t.Fatal("a disabled check still called GitHub")
	}
	var att attentionJSON
	json.Unmarshal([]byte(b.get("/attention").Body), &att)
	if len(att.Rows) != 0 {
		t.Fatalf("rows = %v", att.kinds())
	}
	if r := b.get("/about"); strings.Contains(r.Body, `"update":{`) {
		t.Fatalf("about still shows an update: %s", r.Body)
	}
}

func TestNoticesCreditRadarrSonarrAndTRaSH(t *testing.T) {
	b := newInstance(t, "").setUp()
	r := b.get("/about/notices")
	if r.Status != 200 || !strings.Contains(r.Body, "Radarr") || !strings.Contains(r.Body, "Sonarr") || !strings.Contains(r.Body, "TRaSH") {
		t.Fatalf("notices = %d %.200s", r.Status, r.Body)
	}
}
