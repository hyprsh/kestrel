package trash_test

import (
	"context"
	"errors"
	"io/fs"
	"testing"
	"testing/fstest"
	"time"

	"github.com/hyprsh/kestrel/internal/health"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/settings"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/trash"
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
	ref   trash.Ref
	files fs.FS
	err   error
	calls int
}

func (f *fakeSource) Latest(context.Context) (trash.Ref, error) { return f.ref, f.err }
func (f *fakeSource) Download(context.Context, trash.Ref) (fs.FS, error) {
	f.calls++
	return f.files, nil
}

type env struct {
	svc    *trash.Service
	holder *scoring.Holder
	src    *fakeSource
	health *health.Service
	// rescored records the snapshot each re-score ran under and which one was
	// active at that moment.
	rescored []rescoreCall
	failWith error
	st       *store.Store
}

type rescoreCall struct {
	under, active *scoring.Snapshot
}

func newEnv(t *testing.T) *env {
	t.Helper()
	st, err := store.Open(context.Background(), store.Options{Dir: t.TempDir()})
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

func (e *env) newService() *trash.Service {
	return trash.New(trash.Deps{
		Holder: e.holder, Settings: settings.New(e.st), Source: e.src, Health: e.health, Clock: func() time.Time { return now },
		Titles: func(context.Context) ([]int64, error) { return []int64{1}, nil },
		Rescore: func(_ context.Context, snap *scoring.Snapshot, _ []int64) error {
			e.rescored = append(e.rescored, rescoreCall{under: snap, active: e.holder.Current()})
			return e.failWith
		},
	})
}

func (e *env) offer(commit string, at time.Time) {
	e.src.ref = trash.Ref{Commit: commit, CommittedAt: at}
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

func TestValidUpdateRescoresBeforeItBecomesActive(t *testing.T) {
	e := newEnv(t)
	e.offer("new", now.Add(-time.Hour))
	res, err := e.svc.Update(context.Background())
	if err != nil || !res.Changed {
		t.Fatalf("Update = %+v, %v", res, err)
	}
	if len(e.rescored) != 1 {
		t.Fatalf("re-scored %d times, want once", len(e.rescored))
	}
	c := e.rescored[0]
	if c.under.Commit() != "new" || c.active.Commit() != "old" {
		t.Errorf("re-score ran under %q while %q was active; want new under old", c.under.Commit(), c.active.Commit())
	}
	if e.holder.Current().Commit() != "new" {
		t.Errorf("active = %q after the update", e.holder.Current().Commit())
	}
	if len(e.warnings(t)) != 0 {
		t.Errorf("warnings after a good update: %+v", e.warnings(t))
	}
}

func TestInvalidUpdateChangesNothingAndWarns(t *testing.T) {
	e := newEnv(t)
	before := e.holder.Current()
	e.src.ref = trash.Ref{Commit: "broken", CommittedAt: now}
	e.src.files = fstest.MapFS{"COMMIT": {Data: []byte("broken")}} // no app directories
	if _, err := e.svc.Update(context.Background()); err == nil {
		t.Fatal("a broken snapshot was accepted")
	}
	if e.holder.Current() != before || len(e.rescored) != 0 {
		t.Error("a rejected update changed the active snapshot or re-scored files")
	}
	rows := e.warnings(t)
	if len(rows) != 1 || rows[0].Severity != health.Warning || rows[0].Kind != health.KindTrashRejected {
		t.Fatalf("rows = %+v, want one TRaSH update rejected Warning", rows)
	}
}

func TestFailedRescoreRejectsTheWholeUpdate(t *testing.T) {
	e := newEnv(t)
	before := e.holder.Current()
	e.offer("new", now)
	e.failWith = errors.New("profile german-hd no longer resolves")
	if _, err := e.svc.Update(context.Background()); err == nil {
		t.Fatal("update succeeded though re-scoring failed")
	}
	if e.holder.Current() != before {
		t.Error("the new snapshot became active")
	}
	if len(e.warnings(t)) != 1 {
		t.Error("no Warning raised")
	}
	// The next good update clears the Warning.
	e.failWith = nil
	e.offer("newer", now.Add(time.Minute))
	if _, err := e.svc.Update(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(e.warnings(t)) != 0 {
		t.Error("the Warning stayed after a good update")
	}
}

func TestSameCommitIsNotDownloadedAgain(t *testing.T) {
	e := newEnv(t)
	e.offer("old", now.AddDate(0, 0, -10))
	res, err := e.svc.Update(context.Background())
	if err != nil || res.Changed || e.src.calls != 0 {
		t.Fatalf("res = %+v, err = %v, downloads = %d", res, err, e.src.calls)
	}
}

func TestDailyCheckFollowsTheSwitch(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.offer("new", now)
	if on, err := e.svc.AutoUpdate(ctx); err != nil || !on {
		t.Fatalf("auto update default = %v, %v; want on", on, err)
	}
	if err := e.svc.SetAutoUpdate(ctx, false); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.Check(ctx); err != nil || e.holder.Current().Commit() != "old" {
		t.Fatalf("Check with the switch off changed the snapshot (%v)", err)
	}
	if err := e.svc.SetAutoUpdate(ctx, true); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.Check(ctx); err != nil || e.holder.Current().Commit() != "new" {
		t.Fatalf("Check with the switch on: %v, active %q", err, e.holder.Current().Commit())
	}
}

func TestStartupTakesTheNewerOfDownloadedAndEmbedded(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.offer("downloaded", now.Add(-24*time.Hour))
	if _, err := e.svc.Update(ctx); err != nil {
		t.Fatal(err)
	}
	// A restart on a binary whose embedded snapshot is older: the download wins.
	e.holder = scoring.NewHolder(mustLoad(t, bundle("embedded-old", now.AddDate(0, 0, -30))))
	svc := e.newService()
	if err := svc.Start(ctx); err != nil {
		t.Fatal(err)
	}
	if got := e.holder.Current().Commit(); got != "downloaded" {
		t.Errorf("active = %q, want downloaded", got)
	}
	// A restart on a newer binary: the embedded one wins.
	e.holder = scoring.NewHolder(mustLoad(t, bundle("embedded-new", now)))
	svc = e.newService()
	if err := svc.Start(ctx); err != nil {
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

func mustLoad(t *testing.T, f fs.FS) *scoring.Snapshot {
	t.Helper()
	s, err := scoring.LoadSnapshot(f)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestPrimaryLanguageChangeRescoresEverything(t *testing.T) {
	e := newEnv(t)
	called := false
	err := e.svc.ChangeLanguage(context.Background(), func() error { called = true; return nil })
	if err != nil || !called || len(e.rescored) != 1 || e.rescored[0].under != e.holder.Current() {
		t.Fatalf("err = %v, called = %v, rescored = %d", err, called, len(e.rescored))
	}
}
