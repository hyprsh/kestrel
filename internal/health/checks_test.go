package health_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/health"
)

func (e env) kindsShowing(t *testing.T) map[health.Kind]health.Row {
	t.Helper()
	out := map[health.Kind]health.Row{}
	for _, r := range e.rows(t) {
		out[r.Kind] = r
	}
	return out
}

var sab = health.Ref{ID: 3, Name: "SABnzbd"}

func TestDownloadClientRowAppearsAfterTwoMinutesOfFailedPollsAndClearsOnTheNextGoodOne(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)

	e.h.ObserveDownloadClient(ctx, sab, &health.Failure{Message: "connection refused"})
	if len(e.rows(t)) != 0 {
		t.Fatal("one failed poll is not yet a problem")
	}
	*e.now = e.now.Add(90 * time.Second)
	e.h.ObserveDownloadClient(ctx, sab, &health.Failure{Message: "connection refused"})
	if len(e.rows(t)) != 0 {
		t.Fatal("90 seconds is not yet two minutes")
	}
	*e.now = e.now.Add(30 * time.Second)
	e.h.ObserveDownloadClient(ctx, sab, &health.Failure{Message: "connection refused"})

	r, ok := e.kindsShowing(t)[health.KindDownloadClient]
	if !ok || r.Severity != health.Blocking || r.Subject.PluginInstanceID != 3 {
		t.Fatalf("rows = %+v", e.rows(t))
	}

	e.h.ObserveDownloadClient(ctx, sab, nil)
	if len(e.rows(t)) != 0 {
		t.Errorf("a good poll should clear it: %+v", e.rows(t))
	}

	// The two minutes start over after a recovery.
	e.h.ObserveDownloadClient(ctx, sab, &health.Failure{Message: "down"})
	if len(e.rows(t)) != 0 {
		t.Errorf("the grace period should restart: %+v", e.rows(t))
	}
}

func TestRepeatedFailedPollsDoNotBumpTheRowEveryTime(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	e.h.ObserveDownloadClient(ctx, sab, &health.Failure{Message: "down"})
	*e.now = e.now.Add(3 * time.Minute)
	for range 5 {
		e.h.ObserveDownloadClient(ctx, sab, &health.Failure{Message: "down"})
	}
	if rows := e.rows(t); len(rows) != 1 || rows[0].Count != 1 {
		t.Errorf("rows = %+v", rows)
	}
}

var alpha = health.Ref{ID: 11, Name: "Alpha"}

func enabledIndexers(refs ...health.Ref) func(*health.Deps) {
	return func(d *health.Deps) {
		d.Checks.EnabledIndexers = func(context.Context) ([]health.Ref, error) { return refs, nil }
	}
}

func TestIndexerFailingIsAWarningAtOnceForAuthAndAfterSixHoursForOtherErrors(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, enabledIndexers(alpha, health.Ref{ID: 12, Name: "Beta"}))

	e.h.ObserveIndexer(ctx, alpha, &health.Failure{Message: "timeout"})
	*e.now = e.now.Add(5*time.Hour + 59*time.Minute)
	e.h.ObserveIndexer(ctx, alpha, &health.Failure{Message: "timeout"})
	if _, ok := e.kindsShowing(t)[health.KindIndexer]; ok {
		t.Fatal("a timeout under six hours is not a row")
	}
	*e.now = e.now.Add(2 * time.Minute)
	e.h.ObserveIndexer(ctx, alpha, &health.Failure{Message: "timeout"})
	r, ok := e.kindsShowing(t)[health.KindIndexer]
	if !ok || r.Severity != health.Warning || r.Subject.PluginInstanceID != 11 {
		t.Fatalf("rows = %+v", e.rows(t))
	}

	e.h.ObserveIndexer(ctx, alpha, nil)
	if len(e.rows(t)) != 0 {
		t.Errorf("a good search should clear it: %+v", e.rows(t))
	}

	beta := health.Ref{ID: 12, Name: "Beta"}
	e.h.ObserveIndexer(ctx, beta, &health.Failure{Auth: true, Message: "API key rejected"})
	if r := e.kindsShowing(t)[health.KindIndexer]; r.Subject.PluginInstanceID != 12 {
		t.Errorf("bad credentials should raise at once: %+v", e.rows(t))
	}
}

func TestNoIndexerCanSearchWhenNoneIsEnabledOrEveryOneFails(t *testing.T) {
	ctx := context.Background()
	enabled := []health.Ref{}
	e := newEnv(t, func(d *health.Deps) {
		d.Checks.EnabledIndexers = func(context.Context) ([]health.Ref, error) { return enabled, nil }
	})

	if err := e.h.RunChecks(ctx); err != nil {
		t.Fatal(err)
	}
	r, ok := e.kindsShowing(t)[health.KindNoIndexer]
	if !ok || r.Severity != health.Blocking {
		t.Fatalf("no indexer enabled: rows = %+v", e.rows(t))
	}

	enabled = []health.Ref{alpha}
	_ = e.h.RunChecks(ctx)
	if len(e.rows(t)) != 0 {
		t.Fatalf("an enabled indexer clears it: %+v", e.rows(t))
	}

	e.h.ObserveIndexer(ctx, alpha, &health.Failure{Auth: true, Message: "API key rejected"})
	rows := e.kindsShowing(t)
	if _, ok := rows[health.KindNoIndexer]; !ok {
		t.Errorf("the only indexer fails: rows = %+v", e.rows(t))
	}

	enabled = []health.Ref{alpha, {ID: 12, Name: "Beta"}}
	e.h.ObserveIndexer(ctx, health.Ref{ID: 12, Name: "Beta"}, nil)
	if _, ok := e.kindsShowing(t)[health.KindNoIndexer]; ok {
		t.Errorf("one indexer works, so searching works: %+v", e.rows(t))
	}
}

func TestNoIndexerRowWaitsForSetupToFinish(t *testing.T) {
	setupDone := false
	e := newEnv(t, enabledIndexers(), func(d *health.Deps) {
		d.Checks.SetupDone = func(context.Context) bool { return setupDone }
	})
	_ = e.h.RunChecks(context.Background())
	if len(e.rows(t)) != 0 {
		t.Fatalf("the wizard has not finished: %+v", e.rows(t))
	}
	setupDone = true
	_ = e.h.RunChecks(context.Background())
	if len(e.rows(t)) != 1 {
		t.Errorf("rows = %+v", e.rows(t))
	}
}

func TestIndexerStatesReportWhoIsFailing(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, enabledIndexers(alpha))
	e.h.ObserveIndexer(ctx, alpha, &health.Failure{Auth: true, Message: "bad key"})
	st := e.h.IndexerStates()
	if got := st[alpha.ID]; !got.Failing || !got.Auth || got.Message != "bad key" {
		t.Errorf("state = %+v", got)
	}
	e.h.ObserveIndexer(ctx, alpha, nil)
	if got := e.h.IndexerStates()[alpha.ID]; got.Failing {
		t.Errorf("state after recovery = %+v", got)
	}
}

func TestMetadataProviderFailureIsBlockingOnAuthAndAWarningAfterADay(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)

	e.h.ObserveMetadata(ctx, "TMDB", &health.Failure{Message: "502"})
	*e.now = e.now.Add(23 * time.Hour)
	e.h.ObserveMetadata(ctx, "TMDB", &health.Failure{Message: "502"})
	if len(e.rows(t)) != 0 {
		t.Fatalf("under a day: %+v", e.rows(t))
	}
	*e.now = e.now.Add(2 * time.Hour)
	e.h.ObserveMetadata(ctx, "TMDB", &health.Failure{Message: "502"})
	if r := e.kindsShowing(t)[health.KindMetadata]; r.Severity != health.Warning {
		t.Fatalf("after a day: %+v", e.rows(t))
	}

	e.h.ObserveMetadata(ctx, "TMDB", &health.Failure{Auth: true, Message: "invalid key"})
	rows := e.rows(t)
	if len(rows) != 1 || rows[0].Severity != health.Blocking {
		t.Fatalf("bad credentials should upgrade the row to Blocking: %+v", rows)
	}

	e.h.ObserveMetadata(ctx, "TMDB", nil)
	if len(e.rows(t)) != 0 {
		t.Errorf("a good refresh clears it: %+v", e.rows(t))
	}
}

func rootsOf(paths *[]string) func(*health.Deps) {
	return func(d *health.Deps) {
		d.Checks.RootFolders = func(context.Context) ([]string, error) { return *paths, nil }
	}
}

func TestRootFolderUnavailableIsRaisedForMissingNonDirectoryAndUnwritableFolders(t *testing.T) {
	ctx := context.Background()
	base := t.TempDir()
	missing := filepath.Join(base, "missing")
	file := filepath.Join(base, "file")
	if err := os.WriteFile(file, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	readonly := filepath.Join(base, "readonly")
	if err := os.Mkdir(readonly, 0o500); err != nil {
		t.Fatal(err)
	}
	fine := filepath.Join(base, "fine")
	if err := os.Mkdir(fine, 0o755); err != nil {
		t.Fatal(err)
	}
	paths := []string{missing, file, fine}
	checkReadonly := os.Geteuid() != 0
	if checkReadonly {
		paths = append(paths, readonly)
	}
	e := newEnv(t, rootsOf(&paths))

	if err := e.h.RunChecks(ctx); err != nil {
		t.Fatal(err)
	}

	got := map[string]health.Row{}
	for _, r := range e.rows(t) {
		if r.Kind != health.KindRootFolder || r.Severity != health.Blocking {
			t.Errorf("unexpected row %+v", r)
		}
		got[r.Key] = r
	}
	want := 2
	if checkReadonly {
		want = 3
	}
	if len(got) != want {
		t.Errorf("rows = %+v, want %d root folder rows", e.rows(t), want)
	}
	if _, ok := got["root_folder:"+fine]; ok {
		t.Error("a usable folder should not be flagged")
	}

	// Fixing it clears the row on the next check.
	if err := os.Mkdir(missing, 0o755); err != nil {
		t.Fatal(err)
	}
	_ = e.h.RunChecks(ctx)
	for _, r := range e.rows(t) {
		if r.Key == "root_folder:"+missing {
			t.Errorf("the created folder should have cleared: %+v", r)
		}
	}
}

func TestRootFoldersTheWizardPrefilledAreNotCheckedBeforeSetupIsDone(t *testing.T) {
	paths := []string{filepath.Join(t.TempDir(), "not-yet")}
	setupDone := false
	e := newEnv(t, rootsOf(&paths), func(d *health.Deps) {
		d.Checks.SetupDone = func(context.Context) bool { return setupDone }
	})
	_ = e.h.RunChecks(context.Background())
	if len(e.rows(t)) != 0 {
		t.Fatalf("rows = %+v", e.rows(t))
	}
	setupDone = true
	_ = e.h.RunChecks(context.Background())
	if len(e.rows(t)) != 1 {
		t.Errorf("rows = %+v", e.rows(t))
	}
}

func TestCheckRootFolderBlocksAnImportUntilTheFolderIsBack(t *testing.T) {
	ctx := context.Background()
	dir := filepath.Join(t.TempDir(), "movies")
	e := newEnv(t)

	err := e.h.CheckRootFolder(ctx, dir)
	if !errors.Is(err, health.ErrRootFolderUnavailable) {
		t.Fatalf("CheckRootFolder(missing) = %v", err)
	}
	if rows := e.rows(t); len(rows) != 1 || rows[0].Kind != health.KindRootFolder {
		t.Fatalf("the check should raise the row at once: %+v", rows)
	}

	if err := os.Mkdir(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := e.h.CheckRootFolder(ctx, dir); err != nil {
		t.Fatalf("CheckRootFolder(usable) = %v", err)
	}
	if rows := e.rows(t); len(rows) != 0 {
		t.Errorf("the check should clear the row: %+v", rows)
	}
}

const gb = 1 << 30

func diskOf(free, total *uint64) func(*health.Deps) {
	return func(d *health.Deps) {
		d.Checks.DataDir = "/data"
		d.Checks.Disk = func(string) (health.Space, error) { return health.Space{Free: *free, Total: *total}, nil }
	}
}

func TestLowDiskSpaceFiresBelowTheLargerOfFivePercentAndFiftyGigabytes(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name        string
		free, total uint64
		low         bool
	}{
		{"plenty", 500 * gb, 2000 * gb, false},
		{"under 50 GB on a small disk", 40 * gb, 400 * gb, true},
		{"over 50 GB but under 5 percent of a huge disk", 80 * gb, 4000 * gb, true},
		{"over both", 300 * gb, 4000 * gb, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			free, total := c.free, c.total
			e := newEnv(t, diskOf(&free, &total))
			if err := e.h.RunChecks(ctx); err != nil {
				t.Fatal(err)
			}
			_, showing := e.kindsShowing(t)[health.KindLowDisk]
			if showing != c.low {
				t.Errorf("low disk row showing = %v, want %v (%+v)", showing, c.low, e.rows(t))
			}
		})
	}
}

func TestLowDiskSpaceClearsOnceThereIsRoom(t *testing.T) {
	free, total := uint64(10*gb), uint64(1000*gb)
	e := newEnv(t, diskOf(&free, &total))
	_ = e.h.RunChecks(context.Background())
	if r := e.kindsShowing(t)[health.KindLowDisk]; r.Severity != health.Warning {
		t.Fatalf("rows = %+v", e.rows(t))
	}
	free = 400 * gb
	_ = e.h.RunChecks(context.Background())
	if len(e.rows(t)) != 0 {
		t.Errorf("rows = %+v", e.rows(t))
	}
}

func TestRegisteredChecksRunWithTheRest(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	e.h.AddCheck("proxy", func(ctx context.Context, h *health.Service) error {
		return h.Raise(ctx, health.Issue{Key: "p", Kind: health.KindProxyHeader, Severity: health.Warning, Message: "Proxy header received from an untrusted address"})
	})
	if err := e.h.RunChecks(ctx); err != nil {
		t.Fatal(err)
	}
	if rows := e.rows(t); len(rows) != 1 || rows[0].Key != "p" {
		t.Errorf("rows = %+v", rows)
	}
}

func TestDisksListsTheDataMountAndEveryRootFolder(t *testing.T) {
	free, total := uint64(10*gb), uint64(1000*gb)
	paths := []string{"/data/media/movies"}
	e := newEnv(t, diskOf(&free, &total), rootsOf(&paths))
	disks, err := e.h.Disks(context.Background())
	if err != nil || len(disks) != 2 {
		t.Fatalf("Disks = %+v, %v", disks, err)
	}
	if disks[0].Path != "/data" || disks[0].Free != 10*gb || disks[0].Total != 1000*gb || disks[1].Path != "/data/media/movies" {
		t.Errorf("Disks = %+v", disks)
	}
}

// A plugin's message that already names the instance is the whole row.
func TestDownloadClientAndIndexerRowsDoNotNameTheInstanceTwice(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, enabledIndexers(alpha))

	e.h.ObserveDownloadClient(ctx, sab, &health.Failure{Auth: true, Message: "SABnzbd rejected the API key"})
	*e.now = e.now.Add(3 * time.Minute)
	e.h.ObserveDownloadClient(ctx, sab, &health.Failure{Auth: true, Message: "SABnzbd rejected the API key"})
	if r := e.kindsShowing(t)[health.KindDownloadClient]; r.Message != "SABnzbd rejected the API key" {
		t.Errorf("download client message = %q", r.Message)
	}

	e.h.ObserveIndexer(ctx, alpha, &health.Failure{Auth: true, Message: "Alpha rejected the API key"})
	if r := e.kindsShowing(t)[health.KindIndexer]; r.Message != "Alpha rejected the API key" {
		t.Errorf("indexer message = %q", r.Message)
	}
}
