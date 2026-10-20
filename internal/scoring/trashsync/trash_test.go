package trashsync_test

import (
	"context"
	"errors"
	"io/fs"
	"testing"
	"testing/fstest"
	"time"

	"github.com/hyprsh/kestrel/internal/health"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/trashsync"
	"github.com/hyprsh/kestrel/internal/settings"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/store/storetest"
)

var now = time.Date(2026, 10, 18, 9, 0, 0, 0, time.UTC)

// bundle is a TRaSH-shaped tree, empty of Custom Formats, for a commit.
func bundle(commit string, at time.Time) fstest.MapFS {
	m := fstest.MapFS{
		"COMMIT":       {Data: []byte(commit + "\n")},
		"COMMITTED_AT": {Data: []byte(at.Format(time.RFC3339) + "\n")},
	}
	for _, app := range []string{"radarr", "sonarr"} {
		for _, dir := range []string{"cf", "cf-groups", "quality-profiles"} {
			m[app+"/"+dir+"/.keep"] = &fstest.MapFile{}
		}
	}
	return m
}

type fakeSource struct {
	ref   trashsync.Ref
	files fs.FS
	err   error
	calls int
}

func (f *fakeSource) Latest(context.Context) (trashsync.Ref, error) { return f.ref, f.err }
func (f *fakeSource) Download(context.Context, trashsync.Ref) (fs.FS, error) {
	f.calls++
	return f.files, nil
}

type env struct {
	svc    *trashsync.Service
	holder *scoring.Holder
	src    *fakeSource
	health *health.Service
	st     *store.Store
}

func newEnv(t *testing.T) *env {
	t.Helper()
	st, err := store.Open(context.Background(), store.Options{Dir: storetest.Dir(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	base, err := scoring.LoadSnapshot(bundle("old", now.AddDate(0, 0, -10)))
	if err != nil {
		t.Fatal(err)
	}
	e := &env{holder: scoring.NewHolder(base), src: &fakeSource{}, st: st}
	e.health = health.New(health.Deps{Store: st, Clock: func() time.Time { return now }})
	e.svc = e.newService()
	return e
}

func (e *env) newService() *trashsync.Service {
	return trashsync.New(trashsync.Deps{
		Holder: e.holder, Settings: settings.New(e.st), Source: e.src, Health: e.health, Clock: func() time.Time { return now },
	})
}

func (e *env) offer(commit string, at time.Time) {
	e.src.ref = trashsync.Ref{Commit: commit, CommittedAt: at}
	e.src.files = bundle(commit, at)
}

func (e *env) warnings(t *testing.T) []health.Row {
	t.Helper()
	rows, err := e.health.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

// update is what jobs.TrashUpdates does around a re-score that succeeds.
func (e *env) update(t *testing.T) *trashsync.Candidate {
	t.Helper()
	ctx := context.Background()
	c, err := e.svc.Fetch(ctx)
	if err != nil || c == nil {
		t.Fatalf("Fetch = %v, %v", c, err)
	}
	if err := e.holder.Exclusive(func() error { e.svc.Activate(ctx, c); return nil }); err != nil {
		t.Fatal(err)
	}
	return c
}

func TestFetchHandsBackTheNewSnapshotWithoutActivatingIt(t *testing.T) {
	e := newEnv(t)
	e.offer("new", now.Add(-time.Hour))

	c, err := e.svc.Fetch(context.Background())

	if err != nil || c == nil || c.Commit() != "new" || c.Snapshot.Commit() != "new" {
		t.Fatalf("Fetch = %+v, %v", c, err)
	}
	if e.holder.Current().Commit() != "old" {
		t.Errorf("active = %q before Activate", e.holder.Current().Commit())
	}
	e.holder.Exclusive(func() error { e.svc.Activate(context.Background(), c); return nil })
	if e.holder.Current().Commit() != "new" || len(e.warnings(t)) != 0 {
		t.Errorf("active = %q, warnings %+v after Activate", e.holder.Current().Commit(), e.warnings(t))
	}
}

func TestInvalidUpdateChangesNothingAndWarns(t *testing.T) {
	e := newEnv(t)
	before := e.holder.Current()
	e.src.ref = trashsync.Ref{Commit: "broken", CommittedAt: now}
	e.src.files = fstest.MapFS{"COMMIT": {Data: []byte("broken")}} // no app directories
	if _, err := e.svc.Fetch(context.Background()); !errors.Is(err, trashsync.ErrRejected) {
		t.Fatalf("a broken snapshot was accepted: %v", err)
	}
	if e.holder.Current() != before {
		t.Error("a rejected update changed the active snapshot")
	}
	rows := e.warnings(t)
	if len(rows) != 1 || rows[0].Severity != health.Warning || rows[0].Kind != health.KindTrashRejected {
		t.Fatalf("rows = %+v, want one TRaSH update rejected Warning", rows)
	}
}

func TestARejectedCandidateRaisesTheWarningUntilTheNextGoodUpdate(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.offer("new", now)
	c, err := e.svc.Fetch(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.svc.Reject(ctx, c, errors.New("profile german-hd no longer resolves")); !errors.Is(err, trashsync.ErrRejected) {
		t.Fatalf("Reject = %v", err)
	}
	if e.holder.Current().Commit() != "old" || len(e.warnings(t)) != 1 {
		t.Error("the snapshot changed or no Warning was raised")
	}

	e.offer("newer", now.Add(time.Minute))
	e.update(t)

	if len(e.warnings(t)) != 0 {
		t.Error("the Warning stayed after a good update")
	}
}

func TestSameCommitIsNotDownloadedAgain(t *testing.T) {
	e := newEnv(t)
	e.offer("old", now.AddDate(0, 0, -10))
	c, err := e.svc.Fetch(context.Background())
	if err != nil || c != nil || e.src.calls != 0 {
		t.Fatalf("c = %+v, err = %v, downloads = %d", c, err, e.src.calls)
	}
}

func TestAutoUpdateIsOnUnlessSwitchedOff(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	if on, err := e.svc.AutoUpdate(ctx); err != nil || !on {
		t.Fatalf("auto update default = %v, %v; want on", on, err)
	}
	if err := e.svc.SetAutoUpdate(ctx, false); err != nil {
		t.Fatal(err)
	}
	if on, err := e.svc.AutoUpdate(ctx); err != nil || on {
		t.Fatalf("auto update after switching off = %v, %v", on, err)
	}
}

func TestStartupTakesTheNewerOfDownloadedAndEmbedded(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.offer("downloaded", now.Add(-24*time.Hour))
	e.update(t)
	// A restart on a binary whose embedded snapshot is older: the download wins.
	e.holder = scoring.NewHolder(mustLoad(t, bundle("embedded-old", now.AddDate(0, 0, -30))))
	svc := e.newService()
	if err := svc.Select(ctx); err != nil {
		t.Fatal(err)
	}
	if got := e.holder.Current().Commit(); got != "downloaded" {
		t.Errorf("active = %q, want downloaded", got)
	}
	// A restart on a newer binary: the embedded one wins.
	e.holder = scoring.NewHolder(mustLoad(t, bundle("embedded-new", now)))
	svc = e.newService()
	if err := svc.Select(ctx); err != nil {
		t.Fatal(err)
	}
	if got := e.holder.Current().Commit(); got != "embedded-new" {
		t.Errorf("active = %q, want embedded-new", got)
	}
	st := svc.Status(ctx)
	if st.Commit != "embedded-new" || !st.CommittedAt.Equal(now) {
		t.Errorf("Status = %+v", st)
	}
}

func TestFilesAreStaleWhenTheActiveSnapshotIsNotTheOneTheyWereScoredUnder(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	if stale, err := e.svc.Stale(ctx); err != nil || !stale {
		t.Fatalf("Stale before any scoring = %v, %v", stale, err)
	}
	e.svc.NoteScored(ctx, "old")
	if stale, err := e.newService().Stale(ctx); err != nil || stale {
		t.Fatalf("Stale on the same snapshot = %v, %v", stale, err)
	}
	// A new binary ships a newer embedded snapshot: the stored Scores are stale.
	e.holder = scoring.NewHolder(mustLoad(t, bundle("embedded-new", now)))
	if stale, err := e.newService().Stale(ctx); err != nil || !stale {
		t.Fatalf("Stale under a newer snapshot = %v, %v", stale, err)
	}
}

func TestADownloadedSnapshotIsNotStaleAtStartup(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.offer("downloaded", now.Add(-24*time.Hour))
	e.update(t)
	e.holder = scoring.NewHolder(mustLoad(t, bundle("embedded-old", now.AddDate(0, 0, -30))))
	svc := e.newService()
	if err := svc.Select(ctx); err != nil {
		t.Fatal(err)
	}
	if stale, err := svc.Stale(ctx); err != nil || stale {
		t.Fatalf("Stale = %v, %v; the files were scored under the download already", stale, err)
	}
}

func mustLoad(t *testing.T, f fs.FS) *scoring.Snapshot {
	t.Helper()
	s, err := scoring.LoadSnapshot(f)
	if err != nil {
		t.Fatal(err)
	}
	return s
}
