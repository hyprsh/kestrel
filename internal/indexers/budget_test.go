package indexers_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/indexers"
	"github.com/hyprsh/kestrel/internal/plugin"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	"github.com/hyprsh/kestrel/internal/plugin/indexer/v1/fake"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
)

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *clock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

// budgetRig is one fake indexer behind a Service on a clock the test moves.
type budgetRig struct {
	r   rig
	f   *fake.Indexer
	clk *clock
	id  int64
	nap []time.Duration
}

func newBudgetRig(t *testing.T, cfg map[string]any) *budgetRig {
	t.Helper()
	f := fake.New("k")
	r := newRig(t, f)
	c := map[string]any{"api_key": "k"}
	for k, v := range cfg {
		c[k] = v
	}
	i, err := r.inst.Create(context.Background(), instances.New{PluginID: fake.ID, Name: "Geek", Priority: 1, Config: c})
	if err != nil {
		t.Fatal(err)
	}
	b := &budgetRig{r: r, f: f, clk: &clock{t: time.Date(2026, 3, 1, 10, 0, 0, 0, time.UTC)}, id: i.ID}
	b.r.svc = indexers.New(r.inst, b.clk.now)
	b.r.svc.SetSleep(func(_ context.Context, d time.Duration) error {
		b.nap = append(b.nap, d)
		b.clk.advance(d)
		return nil
	})
	publish(t, f, "Paddington.2014.1080p.BluRay.x264-GRP", "tt1109624", b.clk.now())
	return b
}

var movieQ = indexers.Query{Media: indexer.MediaMovie, IMDBID: "tt1109624"}

func (b *budgetRig) search(ctx context.Context) indexers.Result { return b.r.svc.Search(ctx, movieQ) }

func TestCode500PausesSearchesAndRSSUntilRetryAfterButNotGrabs(t *testing.T) {
	b := newBudgetRig(t, nil)
	ctx := context.Background()
	rel := b.search(ctx).Releases[0]
	b.f.Exhaust(plugin.LimitSearch, 20*time.Minute)

	res := b.search(ctx)
	if len(res.Failures) != 1 || res.Failures[0].Limit != plugin.LimitSearch {
		t.Fatalf("failures = %+v", res.Failures)
	}
	b.f.Replenish() // the indexer is fine again, but Kestrel keeps its word
	if res := b.search(ctx); len(res.Releases) != 0 || len(res.Failures) != 1 {
		t.Fatalf("paused search = %+v", res)
	}
	if res := b.r.svc.RSS(ctx); len(res.Releases) != 0 || len(res.Failures) == 0 {
		t.Fatalf("RSS during the pause = %+v", res)
	}
	if b.r.svc.GrabsPaused(b.id) {
		t.Error("a 500 must not pause Grabs")
	}
	if _, err := b.r.svc.Fetch(ctx, b.id, rel.DownloadURL); err != nil {
		t.Errorf("Fetch during a search pause: %v", err)
	}

	b.clk.advance(19 * time.Minute)
	if res := b.search(ctx); len(res.Releases) != 0 {
		t.Error("still paused after 19 of 20 minutes")
	}
	b.clk.advance(2 * time.Minute)
	if res := b.search(ctx); len(res.Releases) != 1 || len(res.Failures) != 0 {
		t.Errorf("after Retry-After = %+v", res)
	}
}

func TestCode501PausesGrabsOnlyAndDefaultsToAnHour(t *testing.T) {
	b := newBudgetRig(t, nil)
	ctx := context.Background()
	rel := b.search(ctx).Releases[0]
	b.f.Exhaust(plugin.LimitGrab, 0)

	if _, err := b.r.svc.Fetch(ctx, b.id, rel.DownloadURL); plugin.AsError(err).Limit != plugin.LimitGrab {
		t.Fatalf("Fetch = %v", err)
	}
	b.f.Replenish()
	if !b.r.svc.GrabsPaused(b.id) {
		t.Fatal("Grabs not paused after 501")
	}
	if _, err := b.r.svc.Fetch(ctx, b.id, rel.DownloadURL); plugin.AsError(err).Code != plugin.CodeRateLimited {
		t.Errorf("Fetch while paused = %v", err)
	}
	if res := b.search(ctx); len(res.Releases) != 1 || len(res.Failures) != 0 {
		t.Errorf("a 501 must not pause searches: %+v", res)
	}
	b.clk.advance(59 * time.Minute)
	if !b.r.svc.GrabsPaused(b.id) {
		t.Error("Grabs resumed before the default hour")
	}
	b.clk.advance(2 * time.Minute)
	if b.r.svc.GrabsPaused(b.id) {
		t.Error("Grabs still paused after the hour")
	}
	if _, err := b.r.svc.Fetch(ctx, b.id, rel.DownloadURL); err != nil {
		t.Errorf("Fetch after the pause: %v", err)
	}
}

func TestBare429PausesBothUntilRetryAfter(t *testing.T) {
	b := newBudgetRig(t, nil)
	ctx := context.Background()
	b.f.Exhaust("", 5*time.Minute)

	res := b.search(ctx)
	if len(res.Failures) != 1 || res.Failures[0].Code != plugin.CodeRateLimited {
		t.Fatalf("failures = %+v", res.Failures)
	}
	b.f.Replenish()
	if !b.r.svc.GrabsPaused(b.id) {
		t.Error("a bare 429 must pause Grabs")
	}
	if len(b.search(ctx).Releases) != 0 {
		t.Error("a bare 429 must pause searches")
	}
	b.clk.advance(6 * time.Minute)
	if b.r.svc.GrabsPaused(b.id) || len(b.search(ctx).Releases) != 1 {
		t.Error("both should resume after Retry-After")
	}
}

func TestAReportedSpentDownloadQuotaPausesGrabs(t *testing.T) {
	b := newBudgetRig(t, nil)
	ctx := context.Background()
	b.f.Report(indexer.Limits{Reported: true, APICurrent: 3, APIMax: 100, GrabCurrent: 5, GrabMax: 5})
	b.search(ctx)
	if !b.r.svc.GrabsPaused(b.id) {
		t.Error("grabcurrent >= grabmax must pause Grabs")
	}
	b.f.Report(indexer.Limits{Reported: true, APICurrent: 4, APIMax: 100, GrabCurrent: 1, GrabMax: 5})
	b.search(ctx)
	if b.r.svc.GrabsPaused(b.id) {
		t.Error("Grabs should resume once the indexer reports room")
	}
}

func TestSweepsStopAt80PercentOfTheDailyBudgetWhileRSSAndManualSearchRun(t *testing.T) {
	b := newBudgetRig(t, map[string]any{"api_requests_per_day": float64(10)})
	sweep := indexers.WithSweep(context.Background())
	for i := range 8 {
		if res := b.search(sweep); len(res.Failures) != 0 {
			t.Fatalf("sweep %d stopped early: %+v", i, res.Failures)
		}
	}
	res := b.search(sweep)
	if len(res.Releases) != 0 || len(res.Failures) != 1 {
		t.Fatalf("sweep past 80 %% = %+v", res)
	}
	if b.r.svc.CanSweep(context.Background()) {
		t.Error("CanSweep = true past 80 %")
	}
	if res := b.r.svc.RSS(context.Background()); len(res.Releases) == 0 {
		t.Error("RSS must still run")
	}
	if res := b.search(context.Background()); len(res.Releases) != 1 {
		t.Error("a manual search must still run")
	}

	b.clk.advance(24 * time.Hour) // the next day
	if res := b.search(sweep); len(res.Failures) != 0 {
		t.Errorf("sweep the next day = %+v", res.Failures)
	}
	if !b.r.svc.CanSweep(context.Background()) {
		t.Error("CanSweep = false the next day")
	}
}

func TestAReportedBudgetBeatsTheConfiguredOne(t *testing.T) {
	b := newBudgetRig(t, map[string]any{"api_requests_per_day": float64(1000)})
	b.f.Report(indexer.Limits{Reported: true, APICurrent: 80, APIMax: 100})
	b.search(context.Background())
	if len(b.search(indexers.WithSweep(context.Background())).Failures) != 1 {
		t.Error("sweep should stop: the indexer says 80 of 100")
	}
}

func TestWithoutALimitSweepRequestsAreTenSecondsApart(t *testing.T) {
	b := newBudgetRig(t, nil)
	sweep := indexers.WithSweep(context.Background())
	b.search(sweep)
	b.search(sweep)
	b.search(sweep)
	if len(b.nap) != 2 || b.nap[0] != 10*time.Second || b.nap[1] != 10*time.Second {
		t.Errorf("naps = %v", b.nap)
	}
	b.nap = nil
	b.search(context.Background())
	b.r.svc.RSS(context.Background())
	if len(b.nap) != 0 {
		t.Errorf("manual and RSS requests must not wait: %v", b.nap)
	}
}

func TestErrorsBackOffEscalatinglyAndAConfigChangeLiftsIt(t *testing.T) {
	b := newBudgetRig(t, nil)
	ctx := context.Background()
	if _, err := b.r.inst.Update(ctx, b.id, instances.Patch{Config: map[string]any{"api_key": "wrong"}}); err != nil {
		t.Fatal(err)
	}
	if f := b.search(ctx).Failures; len(f) != 1 || f[0].Code != plugin.CodeAuth {
		t.Fatalf("first failure = %+v", f)
	}
	if st := b.r.svc.Status(b.id, 0); st.BackoffUntil.After(b.clk.now()) {
		t.Errorf("the first failure retries at once: %+v", st)
	}
	b.search(ctx)
	if st := b.r.svc.Status(b.id, 0); !st.BackoffUntil.Equal(b.clk.now().Add(time.Minute)) {
		t.Errorf("the second failure waits a minute: %+v", st)
	}
	if f := b.search(ctx).Failures; len(f) != 1 || f[0].Code != plugin.CodeAuth {
		t.Errorf("during the backoff the failure is repeated: %+v", f)
	}
	if _, err := b.r.inst.Update(ctx, b.id, instances.Patch{Config: map[string]any{"api_key": "k"}}); err != nil {
		t.Fatal(err)
	}
	if res := b.search(ctx); len(res.Failures) != 0 || len(res.Releases) != 1 {
		t.Errorf("fixing the config must lift the backoff: %+v", res)
	}
}

func TestStatusReportsPausesAndBudget(t *testing.T) {
	b := newBudgetRig(t, map[string]any{"api_requests_per_day": float64(100)})
	b.search(context.Background())
	b.f.Exhaust(plugin.LimitSearch, 10*time.Minute)
	b.search(context.Background())
	st := b.r.svc.Status(b.id, 100)
	if st.SearchUsed != 2 || st.SearchMax != 100 {
		t.Errorf("budget = %+v", st)
	}
	if want := b.clk.now().Add(10 * time.Minute); !st.SearchPausedUntil.Equal(want) {
		t.Errorf("SearchPausedUntil = %v, want %v", st.SearchPausedUntil, want)
	}
	if !st.GrabsPausedUntil.IsZero() {
		t.Errorf("GrabsPausedUntil = %v", st.GrabsPausedUntil)
	}
}
