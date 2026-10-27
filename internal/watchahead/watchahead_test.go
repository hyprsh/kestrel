package watchahead_test

import (
	"context"
	"errors"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
	mediaserver "github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1"
	"github.com/hyprsh/kestrel/internal/requests"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/store/storetest"
	"github.com/hyprsh/kestrel/internal/watchahead"
)

const (
	showKey = "/library/metadata/456"
	tvdbID  = 81189
	titleID = int64(7)
)

// clock is a fake clock.
type clock struct{ now time.Time }

func (c *clock) Now() time.Time          { return c.now }
func (c *clock) Advance(d time.Duration) { c.now = c.now.Add(d) }

// plex is a Plex server with a play history, as far as Watch-ahead reads it.
type plex struct {
	mu        sync.Mutex
	plays     []mediaserver.Play
	guids     map[string][]string
	failPlays error
	reads     []time.Time // the "since" of each read
	guidCalls int
}

func (p *plex) Describe() plugin.Manifest {
	return plugin.Manifest{ID: "plex", Name: "Plex", Contract: mediaserver.Contract.ID, Version: "1"}
}
func (*plex) Test(context.Context, plugin.Connection) (plugin.TestResult, error) {
	return plugin.TestResult{}, nil
}
func (*plex) ListOptions(context.Context, plugin.Connection, string) ([]plugin.Option, error) {
	return nil, nil
}
func (*plex) Refresh(context.Context, plugin.Connection, []mediaserver.Change) error { return nil }

func (p *plex) Plays(_ context.Context, _ plugin.Connection, since time.Time) (mediaserver.Plays, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.reads = append(p.reads, since)
	if p.failPlays != nil {
		return mediaserver.Plays{}, p.failPlays
	}
	var out mediaserver.Plays
	for _, pl := range p.plays {
		if pl.ViewedAt.Before(since) {
			continue
		}
		out.Items = append(out.Items, pl)
		out.Through = pl.ViewedAt
	}
	return out, nil
}

func (p *plex) ShowGuids(_ context.Context, _ plugin.Connection, key string) ([]string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.guidCalls++
	g, ok := p.guids[key]
	if !ok {
		return nil, plugin.Errorf(plugin.CodeNotFound, "no such show")
	}
	return g, nil
}

// play adds a play of an episode of the show.
func (p *plex) play(at time.Time, key string, season, episode int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.plays = append(p.plays, mediaserver.Play{ViewedAt: at, ShowKey: key, Season: season, Episode: episode})
}

// reqs is the Request module: one Watch-ahead Request.
type reqs struct {
	mu      sync.Mutex
	ask     requests.WatchAhead
	added   []int
	failAdd error
}

func (r *reqs) WatchAheads(context.Context) ([]requests.WatchAhead, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	a := r.ask
	a.Seasons = slices.Clone(a.Seasons)
	return []requests.WatchAhead{a}, nil
}

func (r *reqs) AddSeason(_ context.Context, id int64, season int) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.failAdd != nil {
		return false, r.failAdd
	}
	if !slices.Contains(r.ask.Seasons, season) {
		r.ask.Seasons = append(r.ask.Seasons, season)
		r.added = append(r.added, season)
	}
	return true, nil
}

// lib is the Library: TheTVDB's seasons of the Series, which a test changes.
type lib struct{ seasons []int }

func (l *lib) Get(context.Context, int64, library.View) (library.Detail, error) {
	d := library.Detail{ID: titleID, Kind: library.Series, TVDBID: tvdbID}
	for _, n := range l.seasons {
		d.Seasons = append(d.Seasons, library.Season{Number: n})
	}
	return d, nil
}

type insts struct {
	reg  *plugin.Registry
	list []instances.Instance
}

func (i insts) List(context.Context) ([]instances.Instance, error) { return i.list, nil }
func (i insts) Registry() *plugin.Registry                         { return i.reg }

type world struct {
	t    *testing.T
	clk  *clock
	st   *store.Store
	plex *plex
	reqs *reqs
	lib  *lib
	hist *history.Service
	on   bool
	svc  *watchahead.Service
}

// newWorld is a household with Watch-ahead on, a Request for the Series made at
// the clock's time holding season 1, and TheTVDB listing seasons 0 to 2.
func newWorld(t *testing.T) *world {
	t.Helper()
	st, err := store.Open(context.Background(), store.Options{Dir: storetest.Dir(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	clk := &clock{now: time.Date(2026, 10, 27, 12, 0, 0, 0, time.UTC)}
	w := &world{t: t, clk: clk, st: st, on: true,
		plex: &plex{guids: map[string][]string{showKey: {"imdb://tt0903747", "tvdb://81189"}}},
		reqs: &reqs{ask: requests.WatchAhead{RequestID: 3, TitleID: titleID, Seasons: []int{1}, CreatedAt: clk.now}},
		lib:  &lib{seasons: []int{0, 1, 2}},
		hist: history.New(st, clk.Now, nil),
	}
	reg := plugin.NewRegistry()
	if err := reg.Register(mediaserver.Contract, w.plex); err != nil {
		t.Fatal(err)
	}
	// The plugin instance row, which the history position and the show mapping refer to.
	if _, err := st.Write().Exec(`INSERT INTO plugin_instances (id, contract, plugin_id, name, enabled, priority, config, declared) VALUES (1, 'media_server.v1', 'plex', 'Plex', 1, 0, '{}', 0)`); err != nil {
		t.Fatal(err)
	}
	// The Title and Request that the Log's entry refers to.
	for _, q := range []string{
		`INSERT INTO titles (id, kind, tvdb_id, title, original_title, primary_title, root_folder, added_at, refreshed_at) VALUES (7, 'series', 81189, 'Breaking Bad', 'Breaking Bad', 'Breaking Bad', '/tv', '2026-10-27T12:00:00Z', '2026-10-27T12:00:00Z')`,
		`INSERT INTO requests (id, source, source_request_id, requester_id, requester_name, title_id, outcome, created_at) VALUES (3, 'plex', 'x', '10', 'anna', 7, 'accepted', '2026-10-27T12:00:00Z')`,
	} {
		if _, err := st.Write().Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	w.svc = watchahead.New(watchahead.Deps{
		Store: st, Clock: clk.Now, Instances: insts{reg: reg, list: []instances.Instance{{ID: 1, Name: "Plex", PluginID: "plex", Contract: mediaserver.Contract.ID}}},
		Requests: w.reqs, Library: w.lib, History: w.hist,
		Config: func(context.Context) (watchahead.Config, error) {
			return watchahead.Config{Enabled: w.on, Instance: "Plex"}, nil
		},
	})
	return w
}

func (w *world) pass() int {
	w.t.Helper()
	n, err := w.svc.Pass(context.Background())
	if err != nil {
		w.t.Fatalf("pass: %v", err)
	}
	return n
}

// watch plays an episode of the show a minute after the last, as someone does.
func (w *world) watch(season, episode int) {
	w.clk.Advance(time.Minute)
	w.plex.play(w.clk.now, showKey, season, episode)
}

func (w *world) seasons() []int { return w.reqs.ask.Seasons }

func TestTheNextSeasonIsAddedOnceTwoEpisodesOfTheNewestSeasonWerePlayed(t *testing.T) {
	w := newWorld(t)
	w.watch(1, 1)
	if n := w.pass(); n != 0 || !slices.Equal(w.seasons(), []int{1}) {
		t.Fatalf("after one episode: added %d, seasons %v, want nothing", n, w.seasons())
	}
	w.watch(1, 2)
	if n := w.pass(); n != 1 || !slices.Equal(w.seasons(), []int{1, 2}) {
		t.Fatalf("after two episodes: added %d, seasons %v, want season 2", n, w.seasons())
	}
	evs, err := w.hist.List(context.Background(), history.Filter{Kinds: []history.Kind{history.WatchAheadAdded}})
	if err != nil || len(evs) != 1 || evs[0].Message != "Watch-ahead added season 2" || evs[0].RequestID != 3 || evs[0].TitleID != titleID {
		t.Fatalf("events = %+v %v, want one saying Watch-ahead added season 2", evs, err)
	}
}

func TestTheSameEpisodePlayedTwiceCountsOnce(t *testing.T) {
	w := newWorld(t)
	w.watch(1, 1)
	w.watch(1, 1) // another account, or a rewatch
	w.pass()
	if !slices.Equal(w.seasons(), []int{1}) {
		t.Fatalf("seasons = %v, want 1 alone", w.seasons())
	}
}

func TestAPassRepeatedAddsNothingMore(t *testing.T) {
	w := newWorld(t)
	w.watch(1, 1)
	w.watch(1, 2)
	w.pass()
	if n := w.pass(); n != 0 || !slices.Equal(w.reqs.added, []int{2}) {
		t.Fatalf("second pass added %d, added so far %v", n, w.reqs.added)
	}
	events, _ := w.hist.List(context.Background(), history.Filter{Kinds: []history.Kind{history.WatchAheadAdded}})
	if len(events) != 1 {
		t.Errorf("events = %d, want 1", len(events))
	}
}

func TestPlaysOfSeasonZeroAndOfOlderSeasonsDoNotCount(t *testing.T) {
	w := newWorld(t)
	w.watch(0, 1)
	w.watch(0, 2)
	w.pass()
	if !slices.Equal(w.seasons(), []int{1}) {
		t.Fatalf("seasons = %v after two specials, want 1 alone", w.seasons())
	}
	w.watch(1, 1)
	w.watch(1, 2)
	w.pass() // season 2 is added
	w.watch(1, 3)
	w.watch(1, 4)
	w.pass() // season 1 is no longer the newest: the Request holds 2 now
	if !slices.Equal(w.seasons(), []int{1, 2}) {
		t.Fatalf("seasons = %v, want season 2 held and no season 3", w.seasons())
	}
}

func TestANextSeasonTheTVDBDoesNotListYetIsAddedOnceItDoes(t *testing.T) {
	w := newWorld(t)
	w.lib.seasons = []int{0, 1}
	w.watch(1, 1)
	w.watch(1, 2)
	if n := w.pass(); n != 0 || !slices.Equal(w.seasons(), []int{1}) {
		t.Fatalf("added %d, seasons %v, want nothing while TheTVDB lists no season 2", n, w.seasons())
	}
	w.clk.Advance(24 * time.Hour)
	w.lib.seasons = []int{0, 1, 2}
	if n := w.pass(); n != 1 || !slices.Equal(w.seasons(), []int{1, 2}) {
		t.Fatalf("added %d, seasons %v, want season 2 on the pass after TheTVDB lists it", n, w.seasons())
	}
}

func TestTheNextSeasonIsTheNextOneTheTVDBListsEvenWithAGap(t *testing.T) {
	w := newWorld(t)
	w.lib.seasons = []int{0, 1, 3}
	w.watch(1, 1)
	w.watch(1, 2)
	w.pass()
	if !slices.Equal(w.seasons(), []int{1, 3}) {
		t.Fatalf("seasons = %v, want 3 after 1", w.seasons())
	}
}

func TestASeasonAlreadyPlayedEnoughMovesTheRequestOnAgain(t *testing.T) {
	w := newWorld(t)
	w.lib.seasons = []int{0, 1, 2, 3}
	w.watch(1, 1)
	w.watch(1, 2)
	w.watch(2, 1)
	w.watch(2, 2)
	if n := w.pass(); n != 2 || !slices.Equal(w.seasons(), []int{1, 2, 3}) {
		t.Fatalf("added %d, seasons %v, want seasons 2 and 3", n, w.seasons())
	}
}

func TestAPassThatFailsLosesNoPlay(t *testing.T) {
	w := newWorld(t)
	w.watch(1, 1)
	w.watch(1, 2)
	w.plex.failPlays = errors.New("Plex is down")
	if _, err := w.svc.Pass(context.Background()); err == nil {
		t.Fatal("the pass hid the failure")
	}
	w.plex.failPlays = nil
	w.reqs.failAdd = errors.New("database is locked")
	if _, err := w.svc.Pass(context.Background()); err == nil {
		t.Fatal("the pass hid the failure to add")
	}
	w.reqs.failAdd = nil
	if n := w.pass(); n != 1 || !slices.Equal(w.seasons(), []int{1, 2}) {
		t.Fatalf("added %d, seasons %v, want season 2 on the pass that works", n, w.seasons())
	}
}

func TestPassesReadOnFromWhereTheLastOneStopped(t *testing.T) {
	w := newWorld(t)
	start := w.clk.now
	w.watch(1, 1)
	w.pass()
	w.watch(1, 2) // played after the first pass
	w.pass()
	if !slices.Equal(w.seasons(), []int{1, 2}) {
		t.Fatalf("seasons = %v, want 2 added from plays on two passes", w.seasons())
	}
	if len(w.plex.reads) != 2 || !w.plex.reads[0].Equal(start) || !w.plex.reads[1].Equal(start.Add(time.Minute)) {
		t.Errorf("reads from %v, want the Request's time and then the newest play read", w.plex.reads)
	}
}

func TestPlaysFromBeforeTheRequestDoNotCountForIt(t *testing.T) {
	w := newWorld(t)
	w.plex.play(w.clk.now.Add(-48*time.Hour), showKey, 1, 1)
	w.plex.play(w.clk.now.Add(-47*time.Hour), showKey, 1, 2)
	w.watch(1, 3)
	w.pass()
	if !slices.Equal(w.seasons(), []int{1}) {
		t.Fatalf("seasons = %v, want 1 alone", w.seasons())
	}
}

func TestAShowIsLookedUpOnceAndAShowWithoutATVDBIdNeverCounts(t *testing.T) {
	w := newWorld(t)
	w.plex.guids["/library/metadata/900"] = []string{"tmdb://1"}
	w.watch(1, 1)
	w.clk.Advance(time.Minute)
	w.plex.play(w.clk.now, "/library/metadata/900", 1, 1)
	w.clk.Advance(time.Minute)
	w.plex.play(w.clk.now, "/library/metadata/900", 1, 2)
	w.clk.Advance(time.Minute)
	w.plex.play(w.clk.now, "/library/metadata/gone", 1, 2) // not a show Plex still has
	w.pass()
	w.watch(1, 2)
	w.pass()
	if w.plex.guidCalls != 3 {
		t.Errorf("show lookups = %d, want 3: one per show, though two passes saw them", w.plex.guidCalls)
	}
	if !slices.Equal(w.seasons(), []int{1, 2}) {
		t.Errorf("seasons = %v, want 2 added by the show with TheTVDB's id only", w.seasons())
	}
}

func TestWatchAheadDoesNothingWhileSwitchedOff(t *testing.T) {
	w := newWorld(t)
	w.watch(1, 1)
	w.watch(1, 2)
	w.on = false
	if n := w.pass(); n != 0 || len(w.plex.reads) != 0 || len(w.seasons()) != 1 {
		t.Fatalf("added %d, read %d times, seasons %v: want nothing done", n, len(w.plex.reads), w.seasons())
	}
	w.on = true // the plays were not lost
	if n := w.pass(); n != 1 {
		t.Fatalf("added %d after switching on, want 1", n)
	}
}
