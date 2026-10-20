package updates_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/health"
	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/settings"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/store/storetest"
	"github.com/hyprsh/kestrel/internal/updates"
)

// fakeGitHub answers the two endpoints the check uses.
type fakeGitHub struct {
	release    string // JSON body, or "" for 404
	advisories string
	calls      atomic.Int32
	userAgent  string
}

func (f *fakeGitHub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.calls.Add(1)
	f.userAgent = r.Header.Get("User-Agent")
	switch r.URL.Path {
	case "/repos/hyprsh/kestrel/releases/latest":
		if f.release == "" {
			http.NotFound(w, r)
			return
		}
		w.Write([]byte(f.release))
	case "/repos/hyprsh/kestrel/security-advisories":
		w.Write([]byte(f.advisories))
	default:
		http.NotFound(w, r)
	}
}

const advisory = `[{"ghsa_id":"GHSA-aaaa-bbbb-cccc","summary":"Auth bypass","severity":"high","state":"published",
 "html_url":"https://github.com/hyprsh/kestrel/security/advisories/GHSA-aaaa-bbbb-cccc",
 "vulnerabilities":[{"package":{"ecosystem":"other","name":"kestrel"},"vulnerable_version_range":">= 0.1.0, < 0.3.2","first_patched_version":"0.3.2"}]}]`

type env struct {
	svc *updates.Service
	h   *health.Service
	gh  *fakeGitHub
}

func newEnv(t *testing.T, version string, gh *fakeGitHub) env {
	t.Helper()
	st, err := store.Open(context.Background(), store.Options{Dir: storetest.Dir(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	now := time.Date(2026, 10, 18, 9, 0, 0, 0, time.UTC)
	clock := func() time.Time { return now }
	h := health.New(health.Deps{Store: st, Clock: clock, History: history.New(st, clock, nil)})
	srv := httptest.NewServer(gh)
	t.Cleanup(srv.Close)
	svc := updates.New(updates.Deps{Settings: settings.New(st), Health: h, Version: version, APIBase: srv.URL, Clock: clock})
	return env{svc, h, gh}
}

func (e env) rows(t *testing.T) []health.Row {
	t.Helper()
	rows, err := e.h.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func TestSecurityFixWarningWhenAdvisoryCoversRunningVersion(t *testing.T) {
	e := newEnv(t, "0.2.0", &fakeGitHub{release: `{"tag_name":"v0.3.2","html_url":"https://example/r"}`, advisories: advisory})
	if err := e.svc.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	rows := e.rows(t)
	if len(rows) != 1 || rows[0].Kind != health.KindSecurityFix || rows[0].Severity != health.Warning {
		t.Fatalf("rows = %+v", rows)
	}
	for _, want := range []string{"Kestrel 0.2.0", "GHSA-aaaa-bbbb-cccc", "0.3.2"} {
		if !strings.Contains(rows[0].Message, want) {
			t.Errorf("message %q lacks %q", rows[0].Message, want)
		}
	}
	info := e.svc.Info(context.Background())
	if !info.UpdateAvailable || info.Latest != "0.3.2" || info.URL != "https://example/r" || e.gh.userAgent == "" {
		t.Fatalf("info = %+v ua=%q", info, e.gh.userAgent)
	}
}

func TestNoWarningOutsideTheRangeAndWarningClearsAfterUpdate(t *testing.T) {
	gh := &fakeGitHub{release: `{"tag_name":"v0.3.2"}`, advisories: advisory}
	e := newEnv(t, "0.3.2", gh)
	ctx := context.Background()
	if err := e.svc.Check(ctx); err != nil {
		t.Fatal(err)
	}
	if rows := e.rows(t); len(rows) != 0 {
		t.Fatalf("rows = %+v", rows)
	}
	if e.svc.Info(ctx).UpdateAvailable {
		t.Fatal("running the latest")
	}
	// A row raised earlier clears once the running version is outside every range.
	e.h.Raise(ctx, health.Issue{Key: "security_fix:GHSA-old", Kind: health.KindSecurityFix, Severity: health.Warning, Message: "old"})
	if err := e.svc.Check(ctx); err != nil {
		t.Fatal(err)
	}
	if rows := e.rows(t); len(rows) != 0 {
		t.Fatalf("stale row stays: %+v", rows)
	}
}

func TestDisabledSwitchMakesNoRequestsAndClearsRows(t *testing.T) {
	e := newEnv(t, "0.2.0", &fakeGitHub{release: `{"tag_name":"v0.3.2"}`, advisories: advisory})
	ctx := context.Background()
	if err := e.svc.Check(ctx); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.SetEnabled(ctx, false); err != nil {
		t.Fatal(err)
	}
	calls := e.gh.calls.Load()
	if err := e.svc.Check(ctx); err != nil {
		t.Fatal(err)
	}
	if e.gh.calls.Load() != calls || len(e.rows(t)) != 0 || e.svc.Info(ctx).UpdateAvailable {
		t.Fatal("a disabled check calls nothing and shows nothing")
	}
	if e.svc.Enabled(ctx) {
		t.Fatal("switch should be off")
	}
}

func TestEdgeBuildsSkipComparisonAndNoReleaseIsNotAnError(t *testing.T) {
	e := newEnv(t, "edge", &fakeGitHub{advisories: "[]"})
	if err := e.svc.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	if e.svc.Info(context.Background()).UpdateAvailable {
		t.Fatal("edge never has an update")
	}
}
