package acquire_test

import (
	"context"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
)

func TestActiveSaysWhyADownloadIsStuckAndSince(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	g := r.grabOne(t)
	_ = r.sab.SetPhase(g.ClientID, downloadclient.PhaseDownloading, 400)
	_, _ = r.svc.Poll(ctx)
	started := r.clock.now
	stuck := func() (acquire.Stuck, bool) {
		q, _ := r.svc.Active(ctx)
		return q[0].Stuck()
	}
	if _, ok := stuck(); ok {
		t.Fatal("a moving download is not stuck")
	}

	r.clock.now = r.clock.now.Add(acquire.StalledDownloadAfter + time.Minute)
	_, _ = r.svc.Poll(ctx)
	if s, ok := stuck(); !ok || s.Reason != acquire.StuckNoProgress || !s.Since.Equal(started) {
		t.Errorf("stuck = %+v %v, want no_progress since %v", s, ok, started)
	}

	r.clock.now = r.clock.now.Add(time.Minute)
	pausedAt := r.clock.now
	_ = r.sab.SetPhase(g.ClientID, downloadclient.PhasePaused, 400)
	_, _ = r.svc.Poll(ctx)
	if s, ok := stuck(); !ok || s.Reason != acquire.StuckPaused || !s.Since.Equal(pausedAt) {
		t.Errorf("stuck = %+v %v, want paused since %v", s, ok, pausedAt)
	}

	_ = r.sab.SetPhase(g.ClientID, downloadclient.PhaseDownloading, 100)
	_, _ = r.svc.Poll(ctx)
	if _, ok := stuck(); ok {
		t.Error("still stuck after the download moved again")
	}
}
