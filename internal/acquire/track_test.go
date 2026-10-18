package acquire_test

import (
	"context"
	"errors"
	"github.com/hyprsh/kestrel/internal/slot"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/library"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
)

func (r *rig) wanted(t *testing.T, slots ...slot.Slot) []int64 {
	t.Helper()
	var ids []int64
	for _, s := range slots {
		ids = append(ids, r.versions[s])
	}
	return ids
}

func (r *rig) grabOne(t *testing.T) acquire.Grab {
	t.Helper()
	r.publish(t, hd1080, time.Hour)
	out, err := r.svc.SearchWanted(context.Background(), r.titleID, r.wanted(t, slot.Standard))
	if err != nil || len(out.Grabbed) != 1 {
		t.Fatalf("SearchWanted = %+v, %v", out, err)
	}
	return out.Grabbed[0]
}

func TestSearchWantedGrabsTheBestReleaseForEachWantedVersionOnce(t *testing.T) {
	ctx := context.Background()
	r := newRig(t, slot.Standard, slot.FourK)
	r.publish(t, hd1080, time.Hour)
	r.publish(t, uhd, 2*time.Hour)

	out, err := r.svc.SearchWanted(ctx, r.titleID, r.wanted(t, slot.Standard, slot.FourK))
	if err != nil {
		t.Fatal(err)
	}

	if len(out.Searched) != 2 || len(out.Grabbed) != 2 {
		t.Fatalf("outcome = %+v, want both Versions searched and grabbed", out)
	}
	names := map[int64]string{}
	for _, g := range out.Grabbed {
		names[g.VersionID] = g.ReleaseName
		if g.State != "sent" || g.IsUpgrade {
			t.Errorf("grab = %+v", g)
		}
	}
	if names[r.versions[slot.Standard]] != hd1080 || names[r.versions[slot.FourK]] != uhd {
		t.Errorf("grabs = %v, want 1080p for HD and 2160p for UHD", names)
	}

	again, err := r.svc.SearchWanted(ctx, r.titleID, r.wanted(t, slot.Standard, slot.FourK))
	if err != nil || len(again.Searched) != 0 || len(again.Grabbed) != 0 {
		t.Errorf("a second pass = %+v, %v, want nothing: both Versions have an active Grab", again, err)
	}
	if jobs, _ := r.sab.List(ctx, r.sab.Conn(0), "films"); len(jobs) != 2 {
		t.Errorf("client holds %d jobs, want 2", len(jobs))
	}
}

func TestSearchWantedWithNothingToGrabStillCountsAsSearched(t *testing.T) {
	r := newRig(t)

	out, err := r.svc.SearchWanted(context.Background(), r.titleID, r.wanted(t, slot.Standard))

	if err != nil || len(out.Searched) != 1 || len(out.Grabbed) != 0 {
		t.Errorf("outcome = %+v, %v", out, err)
	}
}

func TestSearchWantedSkipsVersionsThatAreNotWanted(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.publish(t, hd1080, time.Hour)
	if _, err := r.deps.Store.Write().ExecContext(ctx, `UPDATE titles SET monitored = 0`); err != nil {
		t.Fatal(err)
	}

	out, err := r.svc.SearchWanted(ctx, r.titleID, r.wanted(t, slot.Standard))

	if err != nil || len(out.Searched) != 0 || len(out.Grabbed) != 0 {
		t.Errorf("an unmonitored Title got %+v, %v, want no search and no Grab", out, err)
	}
}

func TestSearchWantedReportsAGrabThatCouldNotBeSent(t *testing.T) {
	r := newRig(t)
	r.publish(t, hd1080, time.Hour)
	if _, err := r.deps.Store.Write().Exec(`DELETE FROM plugin_instances WHERE plugin_id = 'fake'`); err != nil {
		t.Fatal(err)
	}

	out, err := r.svc.SearchWanted(context.Background(), r.titleID, r.wanted(t, slot.Standard))

	if err == nil || len(out.Searched) != 1 || len(out.Grabbed) != 0 {
		t.Errorf("outcome = %+v, %v, want the searched Version and an error", out, err)
	}
}

func TestPollFollowsAGrabFromSentThroughDownloadingToCompleted(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	g := r.grabOne(t)

	res, err := r.svc.Poll(ctx)
	if err != nil || !res.Active || res.Changed != 0 {
		t.Fatalf("poll of a queued job = %+v, %v, want active and unchanged", res, err)
	}
	q, _ := r.svc.Active(ctx)
	if len(q) != 1 || q[0].Phase != acquire.PhaseQueued || q[0].BytesTotal != 1000 {
		t.Errorf("active = %+v, want one queued Grab", q)
	}

	_ = r.sab.SetPhase(g.ClientID, downloadclient.PhaseDownloading, 400)
	res, _ = r.svc.Poll(ctx)
	got, _ := r.svc.GetGrab(ctx, g.ID)
	q, _ = r.svc.Active(ctx)
	if res.Changed != 1 || got.State != "downloading" || len(q) != 1 || q[0].Phase != acquire.PhaseDownloading || q[0].BytesLeft != 400 {
		t.Errorf("after progress: %+v %+v %+v", res, got, q)
	}

	res, _ = r.svc.Poll(ctx)
	if res.Changed != 0 || !res.Active {
		t.Errorf("polling again with nothing new = %+v, want a no-op", res)
	}

	_ = r.sab.Complete(g.ClientID, "/data/usenet/movies/Paddington")
	res, _ = r.svc.Poll(ctx)
	got, _ = r.svc.GetGrab(ctx, g.ID)
	q, _ = r.svc.Active(ctx)
	if got.State != "completed" || res.Active || len(q) != 1 || q[0].Phase != acquire.PhaseImporting {
		t.Errorf("after completion: %+v %+v %+v, want completed, inactive, still listed as waiting for Import", res, got, q)
	}
}

func TestPollRecordsAFailedJobAndDropsItFromTheActiveList(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	g := r.grabOne(t)
	_ = r.sab.Fail(g.ClientID, downloadclient.FailureEncrypted, "Aborted, encryption detected")

	if _, err := r.svc.Poll(ctx); err != nil {
		t.Fatal(err)
	}

	got, _ := r.svc.GetGrab(ctx, g.ID)
	if got.State != "failed" || got.Failure != "encrypted" {
		t.Errorf("grab = %+v", got)
	}
	if q, _ := r.svc.Active(ctx); len(q) != 0 {
		t.Errorf("active = %+v, want none", q)
	}
}

func TestAPollThatCannotReachTheClientChangesNothing(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	g := r.grabOne(t)
	if _, err := r.deps.Store.Write().Exec(`UPDATE plugin_instances SET config = '{"api_key":"wrong"}' WHERE plugin_id = 'fake'`); err != nil {
		t.Fatal(err)
	}

	_, err := r.svc.Poll(ctx)

	got, _ := r.svc.GetGrab(ctx, g.ID)
	if err == nil || got.State != "sent" {
		t.Errorf("err = %v, grab = %+v", err, got)
	}
}

func TestARestartedServiceRebuildsTheLiveListFromTheRowsAndTheClient(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	g := r.grabOne(t)
	_ = r.sab.SetPhase(g.ClientID, downloadclient.PhaseDownloading, 250)
	fresh, err := acquire.New(r.deps)
	if err != nil {
		t.Fatal(err)
	}

	before, _ := fresh.Active(ctx)
	if len(before) != 1 || before[0].Phase != acquire.PhaseQueued {
		t.Errorf("before the first poll: %+v, want the Grab from its row alone", before)
	}
	if _, err := fresh.Poll(ctx); err != nil {
		t.Fatal(err)
	}

	after, _ := fresh.Active(ctx)
	if len(after) != 1 || after[0].Phase != acquire.PhaseDownloading || after[0].BytesLeft != 250 || after[0].Grab.ID != g.ID {
		t.Errorf("after the first poll: %+v", after)
	}
}

func TestACanceledGrabIsRemovedFromTheClientAndTheVersionIsWantedAgain(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	g := r.grabOne(t)

	got, err := r.svc.Cancel(ctx, g.ID, false)
	if err != nil {
		t.Fatal(err)
	}

	if got.ID != g.ID || got.VersionID != g.VersionID {
		t.Errorf("Cancel returned %+v", got)
	}
	if jobs, _ := r.sab.List(ctx, r.sab.Conn(0), ""); len(jobs) != 0 {
		t.Errorf("client still holds %+v", jobs)
	}
	if _, err := r.svc.GetGrab(ctx, g.ID); !errors.Is(err, acquire.ErrGrabNotFound) {
		t.Errorf("GetGrab = %v, want ErrGrabNotFound", err)
	}
	if q, _ := r.svc.Active(ctx); len(q) != 0 {
		t.Errorf("active = %+v", q)
	}
	d, _ := r.lib.Get(ctx, r.titleID, library.View{Country: "US", Now: r.clock.now})
	if d.Versions[0].State != library.Wanted {
		t.Errorf("Version state = %s, want wanted", d.Versions[0].State)
	}
	res, _ := r.svc.Search(ctx, r.versions[slot.Standard])
	if f := r.found(t, res, hd1080); len(f.Rejections) != 0 {
		t.Errorf("a plain cancel must not blocklist: %+v", f.Rejections)
	}
}

func TestCancelAndBlocklistAlsoBlocklistsTheRelease(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	g := r.grabOne(t)

	if _, err := r.svc.Cancel(ctx, g.ID, true); err != nil {
		t.Fatal(err)
	}

	res, _ := r.svc.Search(ctx, r.versions[slot.Standard])
	f := r.found(t, res, hd1080)
	if len(f.Rejections) != 1 || f.Rejections[0].Code != "blocklisted" {
		t.Errorf("rejections = %+v, want blocklisted", f.Rejections)
	}
}

func TestCancelOfAnUnknownGrabIsErrGrabNotFound(t *testing.T) {
	r := newRig(t)
	if _, err := r.svc.Cancel(context.Background(), 99, false); !errors.Is(err, acquire.ErrGrabNotFound) {
		t.Errorf("err = %v", err)
	}
}
