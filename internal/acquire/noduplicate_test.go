package acquire_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/slot"
)

// gate is an Observer that parks a search at the point it starts asking the indexers, which is after the search
// took its snapshot of what is Wanted, until the test lets it go.
type gate struct {
	started chan struct{}
	release chan struct{}
	once    sync.Once
	count   int
	mu      sync.Mutex
}

func newGate() *gate { return &gate{started: make(chan struct{}), release: make(chan struct{})} }

func (g *gate) Searching(acquire.Target) {
	g.mu.Lock()
	g.count++
	g.mu.Unlock()
	g.once.Do(func() { close(g.started) })
	<-g.release
}
func (g *gate) Releases(int) {}

func (g *gate) searches() int {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.count
}

// jobs are the downloads the client holds.
func (r *rig) jobs(t *testing.T) int {
	t.Helper()
	jobs, err := r.sab.List(context.Background(), r.sab.Conn(0), "")
	if err != nil {
		t.Fatal(err)
	}
	return len(jobs)
}

func TestTwoSearchesOfOneVersionRunOneAfterTheOtherAndSendEachReleaseOnce(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.publish(t, hd1080, time.Hour)
	ver := r.wanted(t, slot.Standard)
	first, second := newGate(), newGate()

	var wg sync.WaitGroup
	var firstOut, secondOut acquire.Outcome
	wg.Add(2)
	go func() {
		defer wg.Done()
		firstOut, _ = r.svc.SearchWanted(acquire.WithObserver(ctx, first), r.titleID, ver)
	}()
	<-first.started
	go func() {
		defer wg.Done()
		secondOut, _ = r.svc.SearchWanted(acquire.WithObserver(ctx, second), r.titleID, ver)
	}()
	select {
	case <-second.started:
		t.Fatal("the second search of the Version started while the first was running")
	case <-time.After(100 * time.Millisecond):
	}
	close(first.release)
	close(second.release) // only matters if the second reaches the indexers: it plans from the state the first left
	wg.Wait()
	if second.searches() != 0 {
		t.Errorf("the second search asked the indexers although the first had grabbed for the Version")
	}

	if len(firstOut.Grabbed) != 1 || len(secondOut.Grabbed) != 0 {
		t.Errorf("grabbed %d then %d, want 1 then 0", len(firstOut.Grabbed), len(secondOut.Grabbed))
	}
	if n := r.jobs(t); n != 1 {
		t.Errorf("download client holds %d jobs, want 1", n)
	}
}

func TestSearchesOfDifferentVersionsRunTogether(t *testing.T) {
	ctx := context.Background()
	r := newRig(t, slot.Standard, slot.FourK)
	std, uhdGate := newGate(), newGate()
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, _ = r.svc.SearchWanted(acquire.WithObserver(ctx, std), r.titleID, []int64{r.versions[slot.Standard]})
	}()
	go func() {
		defer wg.Done()
		_, _ = r.svc.SearchWanted(acquire.WithObserver(ctx, uhdGate), r.titleID, []int64{r.versions[slot.FourK]})
	}()
	for _, g := range []*gate{std, uhdGate} {
		select {
		case <-g.started:
		case <-time.After(5 * time.Second):
			t.Fatal("a search waited for the other Version's search")
		}
	}
	close(std.release)
	close(uhdGate.release)
	wg.Wait()
}

func TestAPlanForAReleaseAnActiveGrabAlreadyHasIsNotSent(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.publish(t, hd1080, time.Hour)
	ver := r.versions[slot.Standard]
	res, err := r.svc.Search(ctx, ver)
	if err != nil {
		t.Fatal(err)
	}
	// The search snapshots the Wanted Version, then a person grabs the Release it is about to plan.
	g := newGate()
	var out acquire.Outcome
	var searchErr error
	done := make(chan struct{})
	go func() {
		defer close(done)
		out, searchErr = r.svc.SearchWanted(acquire.WithObserver(ctx, g), r.titleID, []int64{ver})
	}()
	<-g.started
	if _, err := r.svc.Grab(ctx, ver, r.found(t, res, hd1080).ID, false); err != nil {
		t.Fatal(err)
	}
	close(g.release)
	<-done

	if searchErr != nil || len(out.Grabbed) != 0 {
		t.Errorf("search = %+v, %v, want nothing sent and no error", out, searchErr)
	}
	if n := r.jobs(t); n != 1 {
		t.Errorf("download client holds %d jobs, want 1", n)
	}
}

func TestAPersonGrabbingAReleaseThatIsAlreadyActiveIsToldSo(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	r.publish(t, hd1080, time.Hour)
	ver := r.versions[slot.Standard]
	res, err := r.svc.Search(ctx, ver)
	if err != nil {
		t.Fatal(err)
	}
	id := r.found(t, res, hd1080).ID
	if _, err := r.svc.Grab(ctx, ver, id, false); err != nil {
		t.Fatal(err)
	}
	if _, err := r.svc.Grab(ctx, ver, id, false); !errors.Is(err, acquire.ErrAlreadyGrabbed) {
		t.Fatalf("second Grab error = %v, want ErrAlreadyGrabbed", err)
	}
	if n := r.jobs(t); n != 1 {
		t.Errorf("download client holds %d jobs, want 1", n)
	}
}

func TestAPlanWhoseEpisodesAnActiveGrabTookMeanwhileIsNotSent(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	titleID, ver := r.nightShow(t, library.MonitorAll)
	r.publishShow(t, nightEp1, "1", "1")
	r.publishShow(t, "Night.Show.S01E01.1080p.WEB-DL.H264-ALT", "1", "1")
	res, err := r.svc.Search(ctx, ver)
	if err != nil {
		t.Fatal(err)
	}
	g := newGate()
	var out acquire.Outcome
	done := make(chan struct{})
	go func() {
		defer close(done)
		out, _ = r.svc.SearchWanted(acquire.WithObserver(ctx, g), titleID, []int64{ver})
	}()
	<-g.started
	// A different Release of the same episode is grabbed meanwhile.
	if _, err := r.svc.Grab(ctx, ver, r.found(t, res, "Night.Show.S01E01.1080p.WEB-DL.H264-ALT").ID, false); err != nil {
		t.Fatal(err)
	}
	close(g.release)
	<-done

	for _, gr := range out.Grabbed {
		t.Errorf("sent %s although an active Grab has episode 1", gr.ReleaseName)
	}
	if n := r.jobs(t); n != 1 {
		t.Errorf("download client holds %d jobs, want 1", n)
	}
}

func TestASeasonPackThatIsActiveIsNotGrabbedAgainForAFreedEpisode(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	_, ver := r.nightShow(t, library.MonitorAll)
	r.publishShow(t, nightPack, "1", "")
	res, err := r.svc.Search(ctx, ver)
	if err != nil {
		t.Fatal(err)
	}
	pack := r.found(t, res, nightPack)
	if _, err := r.svc.Grab(ctx, ver, pack.ID, false); err != nil {
		t.Fatal(err)
	}
	// A retry that plans the same pack again: its GUID is active for the Version.
	if _, err := r.svc.Grab(ctx, ver, pack.ID, false); !errors.Is(err, acquire.ErrAlreadyGrabbed) {
		t.Fatalf("second Grab of the pack = %v, want ErrAlreadyGrabbed", err)
	}
	if n := r.jobs(t); n != 1 {
		t.Errorf("download client holds %d jobs, want 1", n)
	}
}

func TestRetriesOfOneVersionCoalesceIntoOneFollowUpSearch(t *testing.T) {
	ctx := context.Background()
	r := newRig(t)
	ver := r.wanted(t, slot.Standard)
	first := newGate()
	type result struct {
		coalesced bool
		err       error
	}
	run := func(c context.Context) result {
		_, coalesced, err := acquire.SearchGuarded(r.svc, c, r.titleID, ver, library.Scope{}, true, false, true)
		return result{coalesced, err}
	}
	firstDone := make(chan result, 1)
	go func() { firstDone <- run(acquire.WithObserver(ctx, first)) }()
	<-first.started

	followUp := newGate()
	followUpDone := make(chan result, 1)
	go func() { followUpDone <- run(acquire.WithObserver(ctx, followUp)) }()
	time.Sleep(100 * time.Millisecond) // the follow-up queues behind the running search
	// Pile on more retries: each is swallowed.
	var swallowed []result
	deadline := time.After(5 * time.Second)
	for len(swallowed) < 3 {
		select {
		case <-deadline:
			t.Fatal("retries did not coalesce")
		default:
		}
		res := make(chan result, 1)
		go func() { res <- run(ctx) }()
		select {
		case got := <-res:
			if !got.coalesced {
				t.Fatalf("a retry ran on its own: %+v", got)
			}
			swallowed = append(swallowed, got)
		case <-time.After(2 * time.Second):
			t.Fatal("a retry blocked instead of coalescing (or the follow-up has not queued yet)")
		}
	}
	close(first.release)
	if got := <-firstDone; got.coalesced || got.err != nil {
		t.Fatalf("first retry = %+v", got)
	}
	<-followUp.started
	close(followUp.release)
	if got := <-followUpDone; got.coalesced || got.err != nil {
		t.Fatalf("follow-up retry = %+v", got)
	}
	if n := first.searches() + followUp.searches(); n != 2 {
		t.Errorf("searches run = %d, want the running one and one follow-up", n)
	}
}
