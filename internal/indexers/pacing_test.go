package indexers_test

import (
	"context"
	"fmt"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/indexers"
	"github.com/hyprsh/kestrel/internal/plugin"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	"github.com/hyprsh/kestrel/internal/plugin/indexer/v1/fake"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
	"github.com/hyprsh/kestrel/internal/store"
)

// latent is a fake indexer that takes took of the test's clock to answer, may ignore
// the season, and remembers what it was asked.
type latent struct {
	*fake.Indexer
	clk          *clock
	mu           sync.Mutex
	took         time.Duration
	ignoreSeason bool
	asked        []indexer.SearchQuery
}

func (l *latent) Search(ctx context.Context, conn plugin.Connection, q indexer.SearchQuery) (indexer.SearchResult, error) {
	l.mu.Lock()
	l.asked = append(l.asked, q)
	took, ignore := l.took, l.ignoreSeason
	l.mu.Unlock()
	l.clk.advance(took)
	if ignore {
		q.Season, q.Episode = "", ""
	}
	return l.Indexer.Search(ctx, conn, q)
}

func (l *latent) setTook(d time.Duration) { l.mu.Lock(); l.took = d; l.mu.Unlock() }
func (l *latent) requests() []indexer.SearchQuery {
	l.mu.Lock()
	defer l.mu.Unlock()
	return slices.Clone(l.asked)
}

// pacingRig is one latent indexer with a search gap behind a Service on the test's clock.
type pacingRig struct {
	svc *indexers.Service
	st  *store.Store
	l   *latent
	clk *clock
	id  int64

	mu   sync.Mutex
	naps []time.Duration
}

func newPacingRig(t *testing.T, gap int) *pacingRig {
	t.Helper()
	clk := &clock{t: time.Date(2026, 3, 1, 10, 0, 0, 0, time.UTC)}
	l := &latent{Indexer: fake.New("k"), clk: clk}
	r := newRig(t, l)
	i, err := r.inst.Create(context.Background(), instances.New{PluginID: fake.ID, Name: "Geek", Priority: 1, Config: map[string]any{"api_key": "k", indexers.SearchGapKey: float64(gap)}})
	if err != nil {
		t.Fatal(err)
	}
	p := &pacingRig{st: r.st, l: l, clk: clk, id: i.ID, svc: indexers.New(r.inst, r.st, clk.now)}
	p.svc.SetSleep(func(_ context.Context, d time.Duration) error {
		p.mu.Lock()
		p.naps = append(p.naps, d)
		p.mu.Unlock()
		clk.advance(d)
		return nil
	})
	publish(t, l.Indexer, "Paddington.2014.1080p.BluRay.x264-GRP", "tt1109624", clk.now())
	return p
}

func (p *pacingRig) napped() []time.Duration {
	p.mu.Lock()
	defer p.mu.Unlock()
	return slices.Clone(p.naps)
}

func (p *pacingRig) forget() { p.mu.Lock(); p.naps = nil; p.mu.Unlock() }

func (p *pacingRig) search(ctx context.Context) indexers.Result { return p.svc.Search(ctx, movieQ) }

func TestSearchRequestsToOneIndexerKeepTheConfiguredGap(t *testing.T) {
	p := newPacingRig(t, 2)
	ctx := context.Background()
	// Two searches of different Versions are two Queries asking the same indexer.
	other := indexers.Query{Media: indexer.MediaMovie, IMDBID: "tt0000001"}
	p.search(ctx)
	p.svc.Search(ctx, other)
	if got := p.napped(); !slices.Equal(got, []time.Duration{2 * time.Second}) {
		t.Fatalf("naps = %v, want one of the gap", got)
	}
	p.clk.advance(time.Minute)
	p.forget()
	p.search(ctx)
	if got := p.napped(); len(got) != 0 {
		t.Errorf("a request after a long quiet waits: %v", got)
	}
}

func TestAManualSearchKeepsHalfTheGapButAtLeastASecond(t *testing.T) {
	for gap, want := range map[int]time.Duration{10: 5 * time.Second, 2: time.Second, 1: time.Second} {
		p := newPacingRig(t, gap)
		manual := indexers.WithManual(context.Background())
		p.search(manual)
		p.search(manual)
		if got := p.napped(); !slices.Equal(got, []time.Duration{want}) {
			t.Errorf("gap %d s: naps = %v, want %v", gap, got, want)
		}
	}
}

func TestAGapOfZeroKeepsNoGap(t *testing.T) {
	p := newPacingRig(t, 0)
	p.search(context.Background())
	p.search(indexers.WithManual(context.Background()))
	p.search(context.Background())
	if got := p.napped(); len(got) != 0 {
		t.Errorf("naps = %v", got)
	}
}

func TestAnInstanceWithoutTheSettingKeepsTwoSeconds(t *testing.T) {
	if got := indexers.SearchGap(instances.Instance{}); got != 2*time.Second {
		t.Errorf("default gap = %v", got)
	}
}

func TestASweepStillWaitsItsOwnLongerGap(t *testing.T) {
	p := newPacingRig(t, 2)
	sweep := indexers.WithSweep(context.Background())
	p.search(sweep)
	p.search(sweep)
	if got := p.napped(); !slices.Equal(got, []time.Duration{10 * time.Second}) {
		t.Fatalf("naps = %v", got)
	}
	// A configured gap longer than the sweep's wins.
	p = newPacingRig(t, 30)
	p.search(sweep)
	p.search(sweep)
	if got := p.napped(); !slices.Equal(got, []time.Duration{30 * time.Second}) {
		t.Errorf("naps = %v", got)
	}
}

func TestRSSReadsKeepNoGap(t *testing.T) {
	p := newPacingRig(t, 5)
	p.search(context.Background())
	p.svc.RSS(context.Background())
	p.svc.RSS(context.Background())
	if got := p.napped(); len(got) != 0 {
		t.Errorf("naps = %v", got)
	}
}

func TestConcurrentSearchesToOneIndexerQueueOnTheGap(t *testing.T) {
	p := newPacingRig(t, 2)
	var wg sync.WaitGroup
	for range 3 {
		wg.Add(1)
		go func() { defer wg.Done(); p.search(context.Background()) }()
	}
	wg.Wait()
	got := p.napped()
	slices.Sort(got)
	// Each request waits its turn: the first goes at once, the others 2 and 4 s behind it.
	// (The test's sleep moves the clock, so the waits it hears are the gaps left to each.)
	if len(got) != 2 || got[0] < 2*time.Second || got[1] < 2*time.Second {
		t.Errorf("naps = %v", got)
	}
}

func TestStatusShowsARequestWaitingOnTheGap(t *testing.T) {
	p := newPacingRig(t, 4)
	ctx := context.Background()
	p.search(ctx)
	if st := p.svc.Status(p.id, 0, 0, 4*time.Second); !st.WaitUntil.IsZero() || st.Gap != 4*time.Second {
		t.Fatalf("idle status = %+v", st)
	}
	release := make(chan struct{})
	slept := make(chan struct{})
	p.svc.SetSleep(func(ctx context.Context, d time.Duration) error {
		close(slept)
		<-release
		return nil
	})
	done := make(chan struct{})
	go func() { defer close(done); p.search(ctx) }()
	<-slept
	st := p.svc.Status(p.id, 0, 0, 4*time.Second)
	if want := p.clk.now().Add(4 * time.Second); !st.WaitUntil.Equal(want) {
		t.Errorf("WaitUntil = %v, want %v", st.WaitUntil, want)
	}
	close(release)
	<-done
}

func TestSlowAnswersWidenTheGapAndQuickOnesNarrowItAgain(t *testing.T) {
	p := newPacingRig(t, 2)
	ctx := context.Background()
	gap := func() (time.Duration, bool) {
		st := p.svc.Status(p.id, 0, 0, 2*time.Second)
		return st.Gap, st.Widened
	}
	p.l.setTook(time.Second)
	for range 4 {
		p.search(ctx)
	}
	if g, w := gap(); g != 2*time.Second || w {
		t.Fatalf("gap with usual answers = %v widened %v", g, w)
	}
	// 4 s is slow against 1 s but under 5 s: not slow enough.
	p.l.setTook(4 * time.Second)
	p.search(ctx)
	if g, _ := gap(); g != 2*time.Second {
		t.Fatalf("gap after a 4 s answer = %v", g)
	}
	p.l.setTook(8 * time.Second)
	want := []time.Duration{4 * time.Second, 8 * time.Second, 16 * time.Second, 30 * time.Second, 30 * time.Second}
	for i, w := range want {
		p.search(ctx)
		if g, widened := gap(); g != w || !widened {
			t.Fatalf("gap after %d slow answers = %v widened %v, want %v", i+1, g, widened, w)
		}
	}
	// The widened gap is what the next request keeps.
	p.forget()
	p.search(ctx)
	if got := p.napped(); len(got) != 1 || got[0] < 20*time.Second {
		t.Errorf("a request after a slow answer waited %v", got)
	}
	p.l.setTook(time.Second)
	var seen []time.Duration
	for range 6 {
		p.search(ctx)
		g, _ := gap()
		seen = append(seen, g)
	}
	if last, widened := seen[len(seen)-1], seen[len(seen)-1] > 2*time.Second; widened || last != 2*time.Second {
		t.Errorf("gaps while answers are quick = %v", seen)
	}
	if seen[0] >= 30*time.Second {
		t.Errorf("the gap did not start narrowing: %v", seen)
	}
}

func tvRelease(t *testing.T, f *fake.Indexer, title, season string, at time.Time) {
	t.Helper()
	err := f.Publish(indexer.Release{Title: title, TVDBID: 81189, Season: season, Size: 1 << 30, PublishDate: at, Categories: []int{5040}}, []byte("<nzb/>"))
	if err != nil {
		t.Fatal(err)
	}
}

func seasonQuery(season int) indexers.Query {
	return indexers.Query{Media: indexer.MediaTV, TVDBID: 81189, Season: fmt.Sprint(season)}
}

func TestAnIndexerThatReturnsTheSameReleasesForTwoSeasonsIsAskedOnceForTheWholeSeries(t *testing.T) {
	p := newPacingRig(t, 0)
	p.l.ignoreSeason = true
	for _, s := range []string{"1", "2"} {
		for e := 1; e <= 2; e++ {
			tvRelease(t, p.l.Indexer, fmt.Sprintf("Show.S0%sE0%d.1080p.WEB-DL-GRP", s, e), s, p.clk.now())
		}
	}
	ctx := context.Background()
	if res := p.svc.Search(ctx, seasonQuery(1)); len(res.Releases) != 4 {
		t.Fatalf("season 1 = %d releases", len(res.Releases))
	}
	if p.svc.IgnoresSeason(p.id) {
		t.Fatal("one answer cannot show that the season is ignored")
	}
	p.svc.Search(ctx, seasonQuery(2))
	if !p.svc.IgnoresSeason(p.id) {
		t.Fatal("two identical answers for two seasons were not noticed")
	}
	before := len(p.l.requests())
	res := p.svc.Search(ctx, seasonQuery(3))
	reqs := p.l.requests()[before:]
	if len(reqs) != 1 || reqs[0].Season != "" || len(res.Releases) != 4 {
		t.Fatalf("season 3: requests %+v, %d releases", reqs, len(res.Releases))
	}
	// The whole-Series answer serves the seasons after it, for a few minutes.
	before = len(p.l.requests())
	p.svc.Search(ctx, seasonQuery(4))
	p.svc.Search(ctx, indexers.Query{Media: indexer.MediaTV, TVDBID: 81189, Season: "4", Episode: "2"})
	if n := len(p.l.requests()) - before; n != 0 {
		t.Errorf("%d requests for seasons answered by the whole-Series answer", n)
	}
	p.clk.advance(10 * time.Minute)
	p.svc.Search(ctx, seasonQuery(5))
	if n := len(p.l.requests()) - before; n != 1 {
		t.Errorf("%d requests after the answer went stale", n)
	}
	// A search by hand wants a fresh answer.
	before = len(p.l.requests())
	p.svc.Search(indexers.WithManual(ctx), seasonQuery(5))
	if n := len(p.l.requests()) - before; n != 1 {
		t.Errorf("a manual search made %d requests", n)
	}
}

func TestAnIndexerThatHeedsTheSeasonIsAskedPerSeasonAsBefore(t *testing.T) {
	p := newPacingRig(t, 0)
	for _, s := range []string{"1", "2"} {
		for e := 1; e <= 3; e++ {
			tvRelease(t, p.l.Indexer, fmt.Sprintf("Show.S0%sE0%d.1080p.WEB-DL-GRP", s, e), s, p.clk.now())
		}
	}
	ctx := context.Background()
	p.svc.Search(ctx, seasonQuery(1))
	p.svc.Search(ctx, seasonQuery(2))
	p.svc.Search(ctx, seasonQuery(1))
	if p.svc.IgnoresSeason(p.id) {
		t.Error("an indexer that answers each season with its own Releases was taken to ignore the season")
	}
	for _, q := range p.l.requests() {
		if q.Season == "" {
			t.Errorf("asked without a season: %+v", q)
		}
	}
}
