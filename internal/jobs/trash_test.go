package jobs_test

import (
	"context"
	"errors"
	"io/fs"
	"testing"
	"testing/fstest"
	"time"

	"github.com/hyprsh/kestrel/internal/health"
	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/trashsync"
	"github.com/hyprsh/kestrel/internal/settings"
	"github.com/hyprsh/kestrel/internal/store"
)

var trashNow = time.Date(2026, 10, 18, 9, 0, 0, 0, time.UTC)

// trashBundle is a TRaSH-shaped tree, empty of Custom Formats, for a commit.
func trashBundle(commit string, at time.Time) fstest.MapFS {
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

type trashSource struct {
	ref   trashsync.Ref
	files fs.FS
	calls int
}

func (f *trashSource) Latest(context.Context) (trashsync.Ref, error) { return f.ref, nil }
func (f *trashSource) Download(context.Context, trashsync.Ref) (fs.FS, error) {
	f.calls++
	return f.files, nil
}

type rescoreCall struct{ under, active *scoring.Snapshot }

type trashEnv struct {
	updates  *jobs.TrashUpdates
	snaps    *trashsync.Service
	holder   *scoring.Holder
	src      *trashSource
	health   *health.Service
	st       *store.Store
	rescored []rescoreCall
	failWith error
}

type oneTitle struct{}

func (oneTitle) Names(context.Context) ([]library.Named, error) {
	return []library.Named{{ID: 1}}, nil
}

type rescorer struct{ e *trashEnv }

func (r rescorer) RescoreTitles(_ context.Context, snap *scoring.Snapshot, _ []int64) error {
	r.e.rescored = append(r.e.rescored, rescoreCall{under: snap, active: r.e.holder.Current()})
	return r.e.failWith
}

func newTrashEnv(t *testing.T) *trashEnv {
	t.Helper()
	st, err := store.Open(context.Background(), store.Options{Dir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	e := &trashEnv{src: &trashSource{}, st: st}
	e.holder = scoring.NewHolder(loadSnapshot(t, trashBundle("old", trashNow.AddDate(0, 0, -10))))
	e.health = health.New(health.Deps{Store: st, Clock: func() time.Time { return trashNow }})
	e.rebuild()
	return e
}

// rebuild is a restart: new services over the same store and the current holder.
func (e *trashEnv) rebuild() {
	e.snaps = trashsync.New(trashsync.Deps{
		Holder: e.holder, Settings: settings.New(e.st), Source: e.src, Health: e.health, Clock: func() time.Time { return trashNow },
	})
	e.updates = jobs.NewTrashUpdates(jobs.TrashUpdatesDeps{Snapshots: e.snaps, Holder: e.holder, Library: oneTitle{}, Rescorer: rescorer{e}})
}

func (e *trashEnv) offer(commit string, at time.Time) {
	e.src.ref = trashsync.Ref{Commit: commit, CommittedAt: at}
	e.src.files = trashBundle(commit, at)
}

func (e *trashEnv) warnings(t *testing.T) []health.Row {
	t.Helper()
	rows, err := e.health.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func loadSnapshot(t *testing.T, f fs.FS) *scoring.Snapshot {
	t.Helper()
	s, err := scoring.LoadSnapshot(f)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestValidTrashUpdateRescoresBeforeItBecomesActive(t *testing.T) {
	e := newTrashEnv(t)
	e.offer("new", trashNow.Add(-time.Hour))
	res, err := e.updates.Update(context.Background())
	if err != nil || !res.Changed || res.Commit != "new" {
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

func TestABrokenTrashSnapshotIsNeverRescoredUnder(t *testing.T) {
	e := newTrashEnv(t)
	before := e.holder.Current()
	e.src.ref = trashsync.Ref{Commit: "broken", CommittedAt: trashNow}
	e.src.files = fstest.MapFS{"COMMIT": {Data: []byte("broken")}} // no app directories
	if _, err := e.updates.Update(context.Background()); !errors.Is(err, trashsync.ErrRejected) {
		t.Fatalf("a broken snapshot was accepted: %v", err)
	}
	if e.holder.Current() != before || len(e.rescored) != 0 {
		t.Error("a rejected update changed the active snapshot or re-scored files")
	}
	if len(e.warnings(t)) != 1 {
		t.Errorf("warnings = %+v, want one", e.warnings(t))
	}
}

func TestAFailedRescoreRejectsTheWholeTrashUpdate(t *testing.T) {
	e := newTrashEnv(t)
	before := e.holder.Current()
	e.offer("new", trashNow)
	e.failWith = errors.New("profile german-hd no longer resolves")
	if _, err := e.updates.Update(context.Background()); !errors.Is(err, trashsync.ErrRejected) {
		t.Fatalf("update succeeded though re-scoring failed: %v", err)
	}
	if e.holder.Current() != before {
		t.Error("the new snapshot became active")
	}
	if len(e.warnings(t)) != 1 {
		t.Error("no Warning raised")
	}
	// The next good update clears the Warning.
	e.failWith = nil
	e.offer("newer", trashNow.Add(time.Minute))
	if _, err := e.updates.Update(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(e.warnings(t)) != 0 {
		t.Error("the Warning stayed after a good update")
	}
}

func TestTheSameTrashCommitIsNotDownloadedOrRescoredAgain(t *testing.T) {
	e := newTrashEnv(t)
	e.offer("old", trashNow.AddDate(0, 0, -10))
	res, err := e.updates.Update(context.Background())
	if err != nil || res.Changed || e.src.calls != 0 || len(e.rescored) != 0 {
		t.Fatalf("res = %+v, err = %v, downloads = %d, re-scores = %d", res, err, e.src.calls, len(e.rescored))
	}
}

func TestTheDailyTrashCheckFollowsTheSwitch(t *testing.T) {
	e := newTrashEnv(t)
	ctx := context.Background()
	e.offer("new", trashNow)
	if err := e.snaps.SetAutoUpdate(ctx, false); err != nil {
		t.Fatal(err)
	}
	if err := e.updates.Check(ctx); err != nil || e.holder.Current().Commit() != "old" {
		t.Fatalf("Check with the switch off changed the snapshot (%v)", err)
	}
	if err := e.snaps.SetAutoUpdate(ctx, true); err != nil {
		t.Fatal(err)
	}
	if err := e.updates.Check(ctx); err != nil || e.holder.Current().Commit() != "new" {
		t.Fatalf("Check with the switch on: %v, active %q", err, e.holder.Current().Commit())
	}
}

func TestTheDailyTrashCheckHonoursTheGitHubSwitch(t *testing.T) {
	e := newTrashEnv(t)
	e.offer("new", trashNow)
	updates := jobs.NewTrashUpdates(jobs.TrashUpdatesDeps{
		Snapshots: e.snaps, Holder: e.holder, Library: oneTitle{}, Rescorer: rescorer{e},
		Enabled: func(context.Context) bool { return false },
	})
	if err := updates.Check(context.Background()); err != nil || e.src.calls != 0 || e.holder.Current().Commit() != "old" {
		t.Fatalf("Check with GitHub checks off: %v, %d downloads", err, e.src.calls)
	}
}

func TestStartupRescoresWhenTheActiveSnapshotIsNotTheOneTheFilesWereScoredUnder(t *testing.T) {
	e := newTrashEnv(t)
	ctx := context.Background()
	if err := e.updates.Start(ctx); err != nil {
		t.Fatal(err)
	}
	e.rescored = nil

	// Same snapshot as last time: nothing to redo.
	e.rebuild()
	if err := e.updates.Start(ctx); err != nil || len(e.rescored) != 0 {
		t.Fatalf("restart on the same snapshot: %v, %d re-scores", err, len(e.rescored))
	}

	// A new binary ships a newer embedded snapshot: the stored Scores are stale.
	e.holder = scoring.NewHolder(loadSnapshot(t, trashBundle("embedded-new", trashNow)))
	e.rebuild()
	if err := e.updates.Start(ctx); err != nil {
		t.Fatal(err)
	}
	if len(e.rescored) != 1 || e.rescored[0].under.Commit() != "embedded-new" {
		t.Fatalf("re-scores = %+v, want one under embedded-new", e.rescored)
	}
	e.rescored = nil
	e.rebuild()
	if err := e.updates.Start(ctx); err != nil || len(e.rescored) != 0 {
		t.Errorf("the next restart re-scored again: %v, %d", err, len(e.rescored))
	}
}

func TestADownloadedTrashSnapshotIsNotRescoredAgainAtStartup(t *testing.T) {
	e := newTrashEnv(t)
	ctx := context.Background()
	e.offer("downloaded", trashNow.Add(-24*time.Hour))
	if _, err := e.updates.Update(ctx); err != nil {
		t.Fatal(err)
	}
	e.rescored = nil
	e.holder = scoring.NewHolder(loadSnapshot(t, trashBundle("embedded-old", trashNow.AddDate(0, 0, -30))))
	e.rebuild()

	if err := e.updates.Start(ctx); err != nil || len(e.rescored) != 0 {
		t.Fatalf("Start: %v, %d re-scores; the files were scored under the download already", err, len(e.rescored))
	}
	if e.holder.Current().Commit() != "downloaded" {
		t.Errorf("active = %q, want the download", e.holder.Current().Commit())
	}
}

func TestPrimaryLanguageChangeRescoresEverything(t *testing.T) {
	e := newTrashEnv(t)
	called := false
	err := e.updates.ChangeLanguage(context.Background(), func() error { called = true; return nil })
	if err != nil || !called || len(e.rescored) != 1 || e.rescored[0].under != e.holder.Current() {
		t.Fatalf("err = %v, called = %v, rescored = %d", err, called, len(e.rescored))
	}
}
