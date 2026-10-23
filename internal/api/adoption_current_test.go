package api_test

import (
	"context"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/hyprsh/kestrel/internal/app"
	"github.com/hyprsh/kestrel/internal/metadata"
)

// gatedMovies holds every Movie lookup once armed, saying which it holds.
type gatedMovies struct {
	metadata.Provider
	armed   atomic.Bool
	reached chan int
	release chan struct{}
}

func (g *gatedMovies) Movie(ctx context.Context, id int) (metadata.MovieDetails, error) {
	if g.armed.Load() {
		g.reached <- id
		<-g.release
	}
	return g.Provider.Movie(ctx, id)
}

func TestWhileCommittingTheProgressNamesTheTitleAndYearNotTheFolder(t *testing.T) {
	t.Parallel()
	g := &gatedMovies{reached: make(chan int, 8), release: make(chan struct{})}
	a := newAdopting(t, func(o *app.Options) { g.Provider, o.Metadata = o.Metadata, g })
	a.put(t, "Paddington (2014)/pad.mkv", "pad")
	a.put(t, "Paddington (2014)/pad.uhd.mkv", "pad4k")
	plan := a.scan(t)
	g.armed.Store(true)

	if r := a.valid("POST", "/adoption/commit", fmt.Sprintf(`{"revision":%d}`, plan.Revision)); r.Status != 202 {
		t.Fatalf("commit = %d %s", r.Status, r.Body)
	}
	<-g.reached

	type current struct {
		Entry string  `json:"entry"`
		Step  string  `json:"step"`
		Files *int    `json:"files"`
		Title *string `json:"title"`
	}
	read := func() *current {
		return decode[struct {
			Progress struct {
				Current *current `json:"current"`
			} `json:"progress"`
		}](t, a.valid("GET", "/adoption", "")).Progress.Current
	}
	cur := read()
	if cur == nil || cur.Step != "moving" || cur.Files == nil || *cur.Files != 2 || cur.Title == nil || *cur.Title != "Paddington (2014)" || !strings.HasSuffix(cur.Entry, "Paddington (2014)") {
		t.Errorf("progress.current while moving = %+v, want the Title and year", cur)
	}
	close(g.release)
	a.settled(t, "committing")
}
