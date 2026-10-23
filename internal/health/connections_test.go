package health_test

import (
	"context"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/health"
)

var plex = health.Ref{ID: 21, Name: "Living room Plex"}

// servers is a fake set of enabled media servers whose Test outcome the test sets.
type servers struct {
	enabled []health.Ref
	result  *health.Failure
	tested  []int64
}

func (s *servers) mod() func(*health.Deps) {
	return func(d *health.Deps) {
		d.Checks.MediaServers = func(context.Context) ([]health.Ref, error) { return s.enabled, nil }
		d.Checks.TestMediaServer = func(_ context.Context, r health.Ref) *health.Failure {
			s.tested = append(s.tested, r.ID)
			return s.result
		}
	}
}

func TestMediaServerRowComesAfterTwoFailedChecksInARowAndClearsOnAGoodOne(t *testing.T) {
	ctx := context.Background()
	s := &servers{enabled: []health.Ref{plex}, result: &health.Failure{Message: "connection refused"}}
	e := newEnv(t, s.mod())

	_ = e.h.RunChecks(ctx)
	if len(e.rows(t)) != 0 {
		t.Fatalf("one failed check is not yet a row: %+v", e.rows(t))
	}
	*e.now = e.now.Add(15 * time.Minute)
	_ = e.h.RunChecks(ctx)
	r, ok := e.kindsShowing(t)[health.KindMediaServer]
	if !ok || r.Severity != health.Warning || r.Subject.PluginInstanceID != 21 || r.Key != "media_server:21" {
		t.Fatalf("rows = %+v", e.rows(t))
	}
	if want := "Living room Plex is unreachable: connection refused"; r.Message != want {
		t.Errorf("message = %q, want %q", r.Message, want)
	}

	s.result = nil
	*e.now = e.now.Add(15 * time.Minute)
	_ = e.h.RunChecks(ctx)
	if len(e.rows(t)) != 0 {
		t.Errorf("a good check should clear it: %+v", e.rows(t))
	}

	// The count starts over after a recovery.
	s.result = &health.Failure{Message: "down"}
	*e.now = e.now.Add(15 * time.Minute)
	_ = e.h.RunChecks(ctx)
	if len(e.rows(t)) != 0 {
		t.Errorf("one failure after a recovery is not yet a row: %+v", e.rows(t))
	}
}

func TestMediaServerAuthFailureRaisesAtTheFirstCheck(t *testing.T) {
	ctx := context.Background()
	s := &servers{enabled: []health.Ref{plex}, result: &health.Failure{Auth: true, Message: "token revoked"}}
	e := newEnv(t, s.mod())

	_ = e.h.RunChecks(ctx)
	r, ok := e.kindsShowing(t)[health.KindMediaServer]
	if !ok || r.Message != "Living room Plex rejected Kestrel's credentials: token revoked" {
		t.Fatalf("rows = %+v", e.rows(t))
	}
}

func TestMediaServersAreCheckedEveryFifteenMinutesNotEveryLoop(t *testing.T) {
	ctx := context.Background()
	s := &servers{enabled: []health.Ref{plex}}
	e := newEnv(t, s.mod())

	_ = e.h.RunChecks(ctx)
	for range 2 {
		*e.now = e.now.Add(5 * time.Minute)
		_ = e.h.RunChecks(ctx)
	}
	if len(s.tested) != 1 {
		t.Fatalf("tested %d times in 10 minutes, want 1", len(s.tested))
	}
	*e.now = e.now.Add(5 * time.Minute)
	_ = e.h.RunChecks(ctx)
	if len(s.tested) != 2 {
		t.Errorf("tested %d times after 15 minutes, want 2", len(s.tested))
	}
}

func TestMediaServerRowGoesWhenTheServerIsDisabledOrDeleted(t *testing.T) {
	ctx := context.Background()
	s := &servers{enabled: []health.Ref{plex}, result: &health.Failure{Auth: true, Message: "token revoked"}}
	e := newEnv(t, s.mod())
	_ = e.h.RunChecks(ctx)
	if len(e.rows(t)) != 1 {
		t.Fatalf("rows = %+v", e.rows(t))
	}
	s.enabled = nil
	*e.now = e.now.Add(5 * time.Minute) // not a check tick for the servers, but the row must go anyway
	_ = e.h.RunChecks(ctx)
	if len(e.rows(t)) != 0 {
		t.Errorf("rows = %+v", e.rows(t))
	}
}

// providers is a fake pair of metadata probes that report through ObserveMetadata, as the app's do.
type providers struct {
	e      env
	result *health.Failure
	probed []string
}

func (p *providers) mod() func(*health.Deps) {
	return func(d *health.Deps) {
		d.Checks.MetadataProbes = map[string]func(context.Context) error{}
		for _, name := range []string{"TMDB", "TheTVDB"} {
			d.Checks.MetadataProbes[name] = func(ctx context.Context) error {
				p.probed = append(p.probed, name)
				p.e.h.ObserveMetadata(ctx, name, p.result)
				return nil
			}
		}
	}
}

func TestIdleMetadataProviderWithARevokedKeyRaisesItsRowWithinTheHour(t *testing.T) {
	ctx := context.Background()
	p := &providers{result: &health.Failure{Auth: true, Message: "invalid key"}}
	p.e = newEnv(t, p.mod())
	e := p.e

	_ = e.h.RunChecks(ctx)
	rows := e.rows(t)
	if len(rows) != 2 || rows[0].Kind != health.KindMetadata || rows[0].Severity != health.Blocking {
		t.Fatalf("rows = %+v", rows)
	}
	// Not probed again until an hour has passed.
	*e.now = e.now.Add(55 * time.Minute)
	_ = e.h.RunChecks(ctx)
	if len(p.probed) != 2 {
		t.Fatalf("probed = %v", p.probed)
	}
	p.result = nil
	*e.now = e.now.Add(5 * time.Minute)
	_ = e.h.RunChecks(ctx)
	if len(p.probed) != 4 || len(e.rows(t)) != 0 {
		t.Errorf("probed = %v, rows = %+v", p.probed, e.rows(t))
	}
}

func TestMetadataProviderWithARealCallInTheHourGetsNoProbe(t *testing.T) {
	ctx := context.Background()
	p := &providers{}
	p.e = newEnv(t, p.mod())
	e := p.e

	_ = e.h.RunChecks(ctx) // first probes both
	*e.now = e.now.Add(50 * time.Minute)
	e.h.ObserveMetadata(ctx, "TMDB", nil) // a real lookup
	*e.now = e.now.Add(15 * time.Minute)  // 65 min since the probe, 15 since the real call
	_ = e.h.RunChecks(ctx)
	if got := p.probed; len(got) != 3 || got[2] != "TheTVDB" {
		t.Errorf("probed = %v, want only TheTVDB the second time", got)
	}
}
