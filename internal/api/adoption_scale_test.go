package api_test

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/app"
	"github.com/hyprsh/kestrel/internal/probe"
)

// countingProber is the path prober that counts its probes.
type countingProber struct{ n atomic.Int64 }

func (p *countingProber) Probe(ctx context.Context, path string) (probe.Info, error) {
	p.n.Add(1)
	return pathProber{}.Probe(ctx, path)
}

func TestAcceptingManySuggestionsReusesWhatTheScanProbedAndTakesNoLongerThanLookingThemUp(t *testing.T) {
	t.Parallel()
	pr := &countingProber{}
	a := newAdopting(t, func(o *app.Options) { o.Prober = pr })
	const n = 300
	for i := range n {
		// A Paddington file far too short for the Movie: a Needs choice row suggesting it, confidently.
		a.put(t, fmt.Sprintf("Paddington (2014) [copy %d]/paddington.short.mkv", i), "x")
	}
	a.scan(t)
	probed := pr.n.Load()
	if got := a.page(t, "filter=needs_choice&limit=1"); got.Total != n {
		t.Fatalf("%d Needs choice rows, want %d", got.Total, n)
	}

	start := time.Now()
	got := a.bulk(t, `{"action":"accept_suggested","filter":"needs_choice"}`)

	changed := 0
	for _, it := range got.Items {
		if it.Result == "changed" {
			changed++
		}
	}
	if changed != n {
		t.Errorf("%d of %d rows settled: %v", changed, n, got.outcomes())
	}
	if again := pr.n.Load() - probed; again != 0 {
		t.Errorf("accepting probed %d files again, want the scan's probes reused", again)
	}
	if took := time.Since(start); took > 20*time.Second {
		t.Errorf("accepting %d rows took %s", n, took)
	}
	if row := a.page(t, "filter=matched&limit=1"); row.Total != n {
		t.Errorf("%d Matched rows after accepting, want %d", row.Total, n)
	}
}

func TestAnEditGoesThroughWhileABulkAcceptIsLookingRowsUp(t *testing.T) {
	t.Parallel()
	g := &gatedMovies{reached: make(chan int, 8), release: make(chan struct{})}
	a := newAdopting(t, func(o *app.Options) { g.Provider, o.Metadata = o.Metadata, g })
	a.put(t, "Paddington (2014)/paddington.short.mkv", "x")
	a.put(t, "The Lost Film (2020) [tmdbid-77]/lost.film.mkv", "lost")
	a.scan(t)
	lost := a.rowOf(t, "The Lost Film (2020) [tmdbid-77]")
	g.armed.Store(true)
	var once sync.Once
	letGo := func() { once.Do(func() { close(g.release) }) }
	t.Cleanup(letGo) // a failed test must not leave the accept hanging

	accepted := make(chan int, 1)
	go func() {
		accepted <- a.do("POST", "/adoption/rows/bulk", `{"action":"accept_suggested","filter":"needs_choice"}`).Status
	}()
	<-g.reached // the accept is waiting for TMDB

	edited := make(chan int, 1)
	go func() { edited <- a.do("PATCH", fmt.Sprintf("/adoption/rows/%d", lost.ID), `{"ticked":false}`).Status }()
	select {
	case status := <-edited:
		if status != 200 {
			t.Errorf("the edit = %d, want 200", status)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("an edit waited for the bulk accept to finish its lookups")
	}
	letGo()

	if status := <-accepted; status != 409 {
		t.Errorf("the accept of a plan that changed meanwhile = %d, want 409", status)
	}
	if row := a.rowOf(t, "Paddington (2014)"); row.Status != "needs_choice" {
		t.Errorf("the row after a refused accept = %+v, want it as it was", row)
	}
}
