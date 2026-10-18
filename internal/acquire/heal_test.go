package acquire_test

import (
	"context"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/library"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
	"github.com/hyprsh/kestrel/internal/resolution"
)

const hd1080web = "Paddington.2014.1080p.WEB-DL.x264-GRP"

// twoCandidates publishes two acceptable Releases and grabs the better one.
func (r *rig) twoCandidates(t *testing.T) acquire.Grab {
	t.Helper()
	r.publish(t, hd1080, time.Hour)
	r.publish(t, hd1080web, 2*time.Hour)
	out, err := r.svc.SearchWanted(context.Background(), r.titleID, r.wanted(t, resolution.HD))
	if err != nil || len(out.Grabbed) != 1 {
		t.Fatalf("SearchWanted = %+v, %v", out, err)
	}
	return out.Grabbed[0]
}

// active is the Grab now fetching for the HD Version, if any.
func (r *rig) active(t *testing.T) []acquire.Active {
	t.Helper()
	a, err := r.svc.Active(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return a
}

func (r *rig) blockedReasons(t *testing.T) []string {
	t.Helper()
	rows, err := r.deps.Store.Read().Query(`SELECT reason FROM blocklist ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			t.Fatal(err)
		}
		out = append(out, s)
	}
	return out
}

func TestAFailedDownloadIsBlocklistedAndTheNextBestReleaseGrabbed(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	first := r.twoCandidates(t)
	_ = r.sab.Fail(first.ClientID, downloadclient.FailureFailed, "Aborted, cannot be completed")

	res, err := r.svc.Poll(ctx)

	if err != nil || !res.Active {
		t.Fatalf("Poll = %+v, %v, want active: a retry is downloading", res, err)
	}
	got, _ := r.svc.GetGrab(ctx, first.ID)
	if got.State != "failed" || got.Failure != acquire.FailureDownload {
		t.Errorf("failed Grab = %+v", got)
	}
	if len(r.blockedReasons(t)) != 1 {
		t.Errorf("blocklist = %v, want the failed Release", r.blockedReasons(t))
	}
	a := r.active(t)
	if len(a) != 1 || a[0].ReleaseName == first.ReleaseName || a[0].State != "sent" {
		t.Fatalf("active = %+v, want the other Release", a)
	}
	if jobs, _ := r.sab.List(ctx, r.sab.Conn(0), ""); len(jobs) != 1 || jobs[0].ClientID != a[0].ClientID {
		t.Errorf("client holds %+v, want only the retry (the failed job and its data removed)", jobs)
	}
}

func TestAFailedUpgradeIsBlocklistedAndTheNextBestUpgradeGrabbed(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.fill(t, -100000)
	r.publish(t, hd1080, time.Hour)
	r.publish(t, hd1080web, 2*time.Hour)
	out, err := r.svc.SearchUpgrades(ctx, r.titleID, r.wanted(t, resolution.HD))
	if err != nil || len(out.Grabbed) != 1 {
		t.Fatalf("SearchUpgrades = %+v, %v", out, err)
	}
	first := out.Grabbed[0]
	_ = r.sab.Fail(first.ClientID, downloadclient.FailureFailed, "Aborted, cannot be completed")

	if _, err := r.svc.Poll(ctx); err != nil {
		t.Fatal(err)
	}

	a := r.active(t)
	if len(a) != 1 || a[0].ReleaseName == first.ReleaseName || !a[0].IsUpgrade {
		t.Fatalf("active = %+v, want the other Release as an Upgrade", a)
	}
}

func TestAnEncryptedDownloadIsBlocklistedAndRetried(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	first := r.twoCandidates(t)
	_ = r.sab.Fail(first.ClientID, downloadclient.FailureEncrypted, "Aborted, encryption detected")

	if _, err := r.svc.Poll(ctx); err != nil {
		t.Fatal(err)
	}

	got, _ := r.svc.GetGrab(ctx, first.ID)
	if got.State != "failed" || got.Failure != acquire.FailureEncrypted || len(r.blockedReasons(t)) != 1 {
		t.Errorf("grab = %+v, blocklist = %v", got, r.blockedReasons(t))
	}
	if a := r.active(t); len(a) != 1 || a[0].ReleaseName == first.ReleaseName {
		t.Errorf("active = %+v, want the next best Release", a)
	}
}

func TestAClientFaultFailsTheGrabWithoutBlocklistingAndRetries(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	first := r.twoCandidates(t)
	_ = r.sab.Fail(first.ClientID, downloadclient.FailureOther, "Unpacking failed, write error or disk is full?")

	if _, err := r.svc.Poll(ctx); err != nil {
		t.Fatal(err)
	}

	got, _ := r.svc.GetGrab(ctx, first.ID)
	if got.State != "failed" || got.Failure != acquire.FailureDownload {
		t.Errorf("grab = %+v, want failed(download_failed)", got)
	}
	if b := r.blockedReasons(t); len(b) != 0 {
		t.Errorf("blocklist = %v, want none: the Release is not at fault", b)
	}
	if a := r.active(t); len(a) != 1 {
		t.Errorf("active = %+v, want a retry", a)
	}
}

func TestARetryUsesTheCachedCandidatesWithoutAskingTheIndexersAgain(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	first := r.twoCandidates(t)
	// A Release that appears after the search must not be seen by a cache-first retry.
	r.publish(t, "Paddington.2014.1080p.Remux.x264-NEW", 0)
	_ = r.sab.Fail(first.ClientID, downloadclient.FailureFailed, "")

	if _, err := r.svc.Poll(ctx); err != nil {
		t.Fatal(err)
	}

	a := r.active(t)
	if len(a) != 1 || a[0].ReleaseName != hd1080web && a[0].ReleaseName != hd1080 {
		t.Errorf("active = %+v, want one of the two cached Releases", a)
	}
}

func TestARetryAfterTheCacheExpiredSearchesAgain(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	first := r.grabOne(t)
	r.clock.now = r.clock.now.Add(acquire.CacheTTL + time.Minute)
	r.publish(t, hd1080web, time.Hour)
	_ = r.sab.Fail(first.ClientID, downloadclient.FailureFailed, "")

	if _, err := r.svc.Poll(ctx); err != nil {
		t.Fatal(err)
	}

	if a := r.active(t); len(a) != 1 || a[0].ReleaseName != hd1080web {
		t.Errorf("active = %+v, want the Release a fresh search found", a)
	}
}

func TestWithNothingLeftTheVersionStaysWantedForTheSweep(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	first := r.grabOne(t)
	_ = r.sab.Fail(first.ClientID, downloadclient.FailureFailed, "")

	res, err := r.svc.Poll(ctx)

	if err != nil || res.Active {
		t.Errorf("Poll = %+v, %v", res, err)
	}
	if a := r.active(t); len(a) != 0 {
		t.Errorf("active = %+v", a)
	}
	d, _ := r.lib.Get(ctx, r.titleID, library.View{Country: "US", Now: r.clock.now})
	if d.Versions[0].State != library.Wanted {
		t.Errorf("Version state = %s, want wanted", d.Versions[0].State)
	}
}

func TestAGrabMissingFromTwoPollsInARowIsLostBlocklistedAndRetried(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	first := r.twoCandidates(t)
	_ = r.sab.Remove(ctx, r.sab.Conn(0), first.ClientID, true)

	if _, err := r.svc.Poll(ctx); err != nil {
		t.Fatal(err)
	}
	if got, _ := r.svc.GetGrab(ctx, first.ID); got.State != "sent" {
		t.Fatalf("after one missed poll the Grab is %q, want sent", got.State)
	}
	if _, err := r.svc.Poll(ctx); err != nil {
		t.Fatal(err)
	}

	got, _ := r.svc.GetGrab(ctx, first.ID)
	if got.State != "failed" || got.Failure != acquire.FailureLost || len(r.blockedReasons(t)) != 1 {
		t.Errorf("grab = %+v, blocklist = %v", got, r.blockedReasons(t))
	}
	if a := r.active(t); len(a) != 1 || a[0].ReleaseName == first.ReleaseName {
		t.Errorf("active = %+v, want the next best Release", a)
	}
}

func TestACompletedGrabTheClientLostIsLostToo(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	g := r.grabOne(t)
	_ = r.sab.Complete(g.ClientID, "/data/usenet/movies/Paddington")
	_, _ = r.svc.Poll(ctx)
	_ = r.sab.Remove(ctx, r.sab.Conn(0), g.ClientID, true)

	_, _ = r.svc.Poll(ctx)
	_, _ = r.svc.Poll(ctx)

	if got, _ := r.svc.GetGrab(ctx, g.ID); got.State != "failed" || got.Failure != acquire.FailureLost {
		t.Errorf("grab = %+v, want failed(lost)", got)
	}
}

func TestAtStartupAGrabTheClientDoesNotListIsLostAtOnce(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	first := r.twoCandidates(t)
	_ = r.sab.Remove(ctx, r.sab.Conn(0), first.ClientID, true)
	fresh, err := acquire.New(r.deps)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := fresh.Reconcile(ctx); err != nil {
		t.Fatal(err)
	}

	got, _ := fresh.GetGrab(ctx, first.ID)
	if got.State != "failed" || got.Failure != acquire.FailureLost {
		t.Errorf("grab = %+v, want failed(lost)", got)
	}
	if a, _ := fresh.Active(ctx); len(a) != 1 || a[0].ReleaseName == first.ReleaseName {
		t.Errorf("active = %+v, want the next best Release", a)
	}
}

func TestARejectedImportIsBlocklistedAndTheNextBestReleaseGrabbed(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	first := r.twoCandidates(t)
	_ = r.sab.Complete(first.ClientID, "/data/usenet/movies/Paddington")
	_, _ = r.svc.Poll(ctx)
	if _, err := r.svc.DueImports(ctx); err != nil {
		t.Fatal(err)
	}

	err := r.svc.RecordImport(ctx, first.ID, true, acquire.ImportOutcome{Status: acquire.ImportRejected, Reason: "language"})

	if err != nil {
		t.Fatal(err)
	}
	got, _ := r.svc.GetGrab(ctx, first.ID)
	if got.State != "failed" || got.Failure != "language" || len(r.blockedReasons(t)) != 1 {
		t.Errorf("grab = %+v, blocklist = %v", got, r.blockedReasons(t))
	}
	if a := r.active(t); len(a) != 1 || a[0].ReleaseName == first.ReleaseName {
		t.Errorf("active = %+v, want the next best Release", a)
	}
}

func TestCancelAndBlocklistGrabsTheNextBestRelease(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	first := r.twoCandidates(t)

	if _, err := r.svc.Cancel(ctx, first.ID, true); err != nil {
		t.Fatal(err)
	}

	if a := r.active(t); len(a) != 1 || a[0].ReleaseName == first.ReleaseName {
		t.Errorf("active = %+v, want the next best Release", a)
	}
}

func TestAStalledImportBacksOffAndKeepsTheVersionBusy(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	g := r.grabOne(t)
	_ = r.sab.Complete(g.ClientID, "/data/usenet/movies/Paddington")
	_, _ = r.svc.Poll(ctx)
	if _, err := r.svc.DueImports(ctx); err != nil {
		t.Fatal(err)
	}
	stall := func() {
		t.Helper()
		if err := r.svc.RecordImport(ctx, g.ID, true, acquire.ImportOutcome{Status: acquire.ImportStalled, Reason: "disk full"}); err != nil {
			t.Fatal(err)
		}
	}

	want := []time.Duration{time.Minute, 5 * time.Minute, 15 * time.Minute, time.Hour, time.Hour}
	for i, wait := range want {
		stall()
		st, err := r.svc.Stalled(ctx)
		if err != nil || len(st) != 1 {
			t.Fatalf("Stalled = %+v, %v", st, err)
		}
		if st[0].Reason != "disk full" || st[0].State != "importing" || st[0].NextAt.Sub(r.clock.now) != wait {
			t.Errorf("step %d: %+v, want the next try in %v", i, st[0], wait)
		}
		r.clock.now = st[0].NextAt
		due, _ := r.svc.DueImports(ctx)
		if len(due) != 1 {
			t.Fatalf("step %d: due = %d, want the stalled Import back", i, len(due))
		}
	}

	r.publish(t, hd1080web, time.Hour)
	out, err := r.svc.SearchWanted(ctx, r.titleID, r.wanted(t, resolution.HD))
	if err != nil || len(out.Searched) != 0 || len(out.Grabbed) != 0 {
		t.Errorf("a Version with a stalled Import was searched: %+v, %v", out, err)
	}
}

func TestRetryNowMakesAStalledImportDueAtOnce(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	g := r.grabOne(t)
	_ = r.sab.Complete(g.ClientID, "/data/usenet/movies/Paddington")
	_, _ = r.svc.Poll(ctx)
	_, _ = r.svc.DueImports(ctx)
	_ = r.svc.RecordImport(ctx, g.ID, true, acquire.ImportOutcome{Status: acquire.ImportStalled, Reason: "disk full"})
	if due, _ := r.svc.DueImports(ctx); len(due) != 0 {
		t.Fatalf("due = %d before the wait is over", len(due))
	}

	if err := r.svc.RetryImport(ctx, g.ID); err != nil {
		t.Fatal(err)
	}

	if due, _ := r.svc.DueImports(ctx); len(due) != 1 {
		t.Errorf("due = %d, want the Import", len(due))
	}
	if err := r.svc.RetryImport(ctx, 999); err != acquire.ErrGrabNotFound {
		t.Errorf("RetryImport of an unknown Grab = %v", err)
	}
}

func TestDiscardFailsAStalledImportWithoutBlocklistingAndFreesTheVersion(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	g := r.grabOne(t)
	_ = r.sab.Complete(g.ClientID, "/data/usenet/movies/Paddington")
	_, _ = r.svc.Poll(ctx)
	_, _ = r.svc.DueImports(ctx)
	_ = r.svc.RecordImport(ctx, g.ID, true, acquire.ImportOutcome{Status: acquire.ImportStalled, Reason: "disk full"})

	if err := r.svc.Discard(ctx, g.ID); err != nil {
		t.Fatal(err)
	}

	got, _ := r.svc.GetGrab(ctx, g.ID)
	if got.State != "failed" || got.Failure != acquire.FailureDiscarded || len(r.blockedReasons(t)) != 0 {
		t.Errorf("grab = %+v, blocklist = %v", got, r.blockedReasons(t))
	}
	if jobs, _ := r.sab.List(ctx, r.sab.Conn(0), ""); len(jobs) != 0 {
		t.Errorf("client still holds %+v", jobs)
	}
	if st, _ := r.svc.Stalled(ctx); len(st) != 0 {
		t.Errorf("stalled = %+v", st)
	}
	if err := r.svc.Discard(ctx, g.ID); err != acquire.ErrGrabNotFound {
		t.Errorf("a second Discard = %v, want ErrGrabNotFound", err)
	}
}

func TestRetryAllAndDiscardAllWorkPerReason(t *testing.T) {
	ctx := context.Background()
	r := newRig(t, resolution.HD, resolution.UHD)
	r.publish(t, hd1080, time.Hour)
	r.publish(t, uhd, time.Hour)
	out, err := r.svc.SearchWanted(ctx, r.titleID, r.wanted(t, resolution.HD, resolution.UHD))
	if err != nil || len(out.Grabbed) != 2 {
		t.Fatalf("SearchWanted = %+v, %v", out, err)
	}
	for i, g := range out.Grabbed {
		_ = r.sab.Complete(g.ClientID, "/data/usenet/movies/x")
		_, _ = r.svc.Poll(ctx)
		_, _ = r.svc.DueImports(ctx)
		reason := "disk full"
		if i == 1 {
			reason = "root folder unavailable"
		}
		_ = r.svc.RecordImport(ctx, g.ID, true, acquire.ImportOutcome{Status: acquire.ImportStalled, Reason: reason})
	}

	n, err := r.svc.RetryStalled(ctx, "disk full")
	if err != nil || n != 1 {
		t.Fatalf("RetryStalled = %d, %v", n, err)
	}
	if due, _ := r.svc.DueImports(ctx); len(due) != 1 {
		t.Errorf("due = %d, want only the disk full one", len(due))
	}
	n, err = r.svc.DiscardStalled(ctx, "")
	if err != nil || n != 2 {
		t.Errorf("DiscardStalled = %d, %v, want both", n, err)
	}
}
