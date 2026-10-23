// Package indexers is the host of the indexer.v1 plugins (ADR 0008). It owns
// what a plugin leaves to its host: which indexers are asked, one lane per
// enabled indexer and all in parallel; paging through a result; falling back
// from an ID search to a text search; and caching each indexer's Caps.
//
// Budgets, pacing and pauses (budget.go) are the host's too: every request a
// lane makes, and every NZB fetch, goes through them.
package indexers

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"sync"
	"time"

	idb "github.com/hyprsh/kestrel/internal/indexers/db"
	"github.com/hyprsh/kestrel/internal/plugin"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
	"github.com/hyprsh/kestrel/internal/store"
)

// ErrNoSuchIndexer means the id names no enabled indexer instance.
var ErrNoSuchIndexer = errors.New("no such indexer")

const (
	capsTTL     = 7 * 24 * time.Hour // Radarr keeps Caps for a week
	defaultPage = 100
	maxPages    = 10
)

// Service searches the enabled indexers.
type Service struct {
	inst  *instances.Service
	st    *store.Store
	clock func() time.Time

	mu       sync.Mutex
	caps     map[int64]cachedCaps
	states   map[int64]*state
	sleep    func(ctx context.Context, d time.Duration) error
	observer Observer
	log      *slog.Logger
}

// Observer hears how each indexer's lane of a search or an RSS read went: nil
// Failure means it worked. Rate-limit pauses are not reported; they are not
// failures. Health uses it to raise "Indexer failing".
type Observer func(ctx context.Context, indexerID int64, name string, f *Failure)

// SetLogger sets where the Service logs what it cannot store; nil keeps slog.Default.
func (s *Service) SetLogger(l *slog.Logger) {
	if l != nil {
		s.log = l
	}
}

// SetObserver sets the Observer; nil stops observing.
func (s *Service) SetObserver(o Observer) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.observer = o
}

type cachedCaps struct {
	caps indexer.Caps
	at   time.Time
	cfg  string // fingerprint of the config the Caps were read with
}

// New returns a Service over the plugin instances. clock is time.Now in production.
func New(inst *instances.Service, st *store.Store, clock func() time.Time) *Service {
	if clock == nil {
		clock = time.Now
	}
	return &Service{inst: inst, st: st, clock: clock, caps: map[int64]cachedCaps{}, states: map[int64]*state{}, sleep: sleepFor, log: slog.Default()}
}

// Query is what to look for, whichever way each indexer can be asked.
type Query struct {
	Media indexer.Media
	// The external IDs of the Title; zero values are not used. An indexer is
	// asked by ID first, when it supports any of them.
	IMDBID string
	TMDBID int
	TVDBID int
	// Titles are the names tried as text when an ID search finds nothing or
	// cannot be made, in order; Year narrows a Movie text search.
	Titles []string
	Year   int
	// Season and Episode as indexers take them; see indexer.SearchQuery.
	Season  string
	Episode string
}

// Release is a release an indexer offered, with where it came from.
type Release struct {
	indexer.Release
	IndexerID       int64
	IndexerName     string
	IndexerPriority int
	// Media is the feed an RSS read took it from; empty for a search.
	Media indexer.Media
	// ByID is true when an ID search found it, false for a text search hit
	// (which the caller should match against the Title's names).
	ByID bool
}

// Failure is one indexer that could not answer fully.
type Failure struct {
	IndexerID   int64
	IndexerName string
	Code        plugin.Code
	Message     string
	// RetryAfter and Limit are set when the indexer said so (a spent budget).
	RetryAfter time.Duration
	Limit      string
}

// Result is what every indexer gave. A failing indexer's partial answer is
// kept in Releases next to its Failure.
type Result struct {
	Releases []Release
	Failures []Failure
}

// Search asks every enabled indexer, in parallel. It returns when all lanes
// are done or ctx ends, whichever is first; lanes that ended with ctx report
// an unavailable Failure.
func (s *Service) Search(ctx context.Context, q Query) Result {
	return s.fan(ctx, func(inst instances.Instance) ([]Release, *Failure) { return s.lane(ctx, inst, q) })
}

// RSS reads the newest releases of every enabled indexer: one lane per
// indexer, one request per kind of media (Movie, then Series) and no paging,
// so a pass costs next to nothing. Each Release says which feed it came from.
func (s *Service) RSS(ctx context.Context) Result {
	return s.fan(ctx, func(inst instances.Instance) ([]Release, *Failure) { return s.rssLane(ctx, inst) })
}

// rssLane reads one indexer's feed for each media. A feed that fails does not
// stop the other; the first failure is reported.
func (s *Service) rssLane(ctx context.Context, inst instances.Instance) (out []Release, failure *Failure) {
	p, ok := s.plugin(inst)
	if !ok {
		return nil, &Failure{IndexerID: inst.ID, IndexerName: inst.Name, Code: plugin.CodeInvalid, Message: "the indexer's plugin is not installed"}
	}
	caps := s.capsOf(ctx, p, inst)
	for _, media := range []indexer.Media{indexer.MediaMovie, indexer.MediaTV} {
		res, err := s.askSearch(ctx, p, inst, indexer.SearchQuery{Media: media, Mode: indexer.ModeRSS, Limit: cmpFirst(caps.MaxPageSize, caps.PageSize, defaultPage)})
		for _, r := range res.Releases {
			out = append(out, Release{Release: r, IndexerID: inst.ID, IndexerName: inst.Name, IndexerPriority: inst.Priority, Media: media})
		}
		if err != nil && failure == nil {
			failure = failureOf(ctx, inst, err)
		}
	}
	return out, failure
}

func failureOf(ctx context.Context, inst instances.Instance, err error) *Failure {
	pe := plugin.AsError(err)
	if ctx.Err() != nil {
		pe = plugin.Errorf(plugin.CodeUnavailable, "the search timed out")
	}
	return &Failure{IndexerID: inst.ID, IndexerName: inst.Name, Code: pe.Code, Message: pe.Message, RetryAfter: pe.RetryAfter, Limit: pe.Limit}
}

// fan runs one lane per enabled indexer, in parallel, and gathers the answers.
func (s *Service) fan(ctx context.Context, lane func(instances.Instance) ([]Release, *Failure)) Result {
	enabled, err := s.inst.Enabled(ctx, indexer.Contract.ID)
	if err != nil {
		return Result{Failures: []Failure{{Code: plugin.CodeUnavailable, Message: err.Error()}}}
	}
	type laneResult struct {
		releases []Release
		failure  *Failure
	}
	lanes := make([]laneResult, len(enabled))
	var wg sync.WaitGroup
	for i, inst := range enabled {
		wg.Add(1)
		go func() {
			defer wg.Done()
			rels, fail := lane(inst)
			lanes[i] = laneResult{rels, fail}
		}()
	}
	wg.Wait()

	s.mu.Lock()
	observe := s.observer
	s.mu.Unlock()
	var out Result
	for i, l := range lanes {
		if f := l.failure; observe != nil && (f == nil || (f.Limit == "" && f.Code != plugin.CodeRateLimited)) {
			observe(ctx, enabled[i].ID, enabled[i].Name, f)
		}
		out.Releases = append(out.Releases, l.releases...)
		if l.failure != nil {
			out.Failures = append(out.Failures, *l.failure)
		}
	}
	return out
}

// Fetch downloads a release's NZB from the indexer it came from.
func (s *Service) Fetch(ctx context.Context, indexerID int64, downloadURL string) ([]byte, error) {
	inst, err := s.inst.Get(ctx, indexerID)
	if err != nil || inst.Contract != indexer.Contract.ID {
		return nil, ErrNoSuchIndexer
	}
	p, ok := s.plugin(inst)
	if !ok {
		return nil, ErrNoSuchIndexer
	}
	s.mu.Lock()
	now := s.clock()
	st := s.stateOf(inst)
	if st.grabUntil.After(now) {
		until := st.grabUntil
		s.mu.Unlock()
		return nil, pausedErr(plugin.LimitGrab, until, now, "Grabs are paused: the indexer's download limit was reached")
	} else if st.grabQuotaSpent(now) {
		s.mu.Unlock()
		return nil, pausedErr(plugin.LimitGrab, now, now, "Grabs are paused: the indexer's download quota is spent")
	}
	limit := configuredGrabLimit(st, inst.Connection().Int(GrabsPerDayKey), now)
	s.mu.Unlock()
	// Every Grab is counted, limit or not, so a limit set later applies to
	// today's count at once. The slot is taken in one SQL statement before the
	// plugin is asked, so two Fetches cannot both take the last one; it is given
	// back if the Fetch returns no NZB. A store that cannot count lets the Grab
	// through uncounted.
	day := utcDay(now)
	maxGrabs := int64(math.MaxInt64)
	if limit > 0 {
		maxGrabs = int64(limit)
	}
	w := idb.New(s.st.Write())
	taken, err := w.TakeGrab(ctx, idb.TakeGrabParams{IndexerID: inst.ID, Day: day, MaxGrabs: maxGrabs})
	counted := err == nil && taken > 0
	switch {
	case err != nil:
		s.log.Warn("indexers: cannot count a Grab; it goes ahead uncounted", "indexer", inst.Name, "err", err)
	case taken == 0:
		return nil, pausedErr(plugin.LimitGrab, nextUTCMidnight(now), now, "Grabs are paused: the indexer's Grabs per day are used up")
	default:
		if err := w.PruneGrabCounts(ctx, idb.PruneGrabCountsParams{IndexerID: inst.ID, Day: day}); err != nil {
			s.log.Warn("indexers: cannot prune past Grab counts", "indexer", inst.Name, "err", err)
		}
	}
	nzb, err := p.Fetch(ctx, inst.Connection(), downloadURL)
	if err != nil && counted {
		if uerr := w.UncountGrab(context.WithoutCancel(ctx), idb.UncountGrabParams{IndexerID: inst.ID, Day: day}); uerr != nil {
			s.log.Warn("indexers: cannot give back the Grab of a Fetch that returned no NZB", "indexer", inst.Name, "err", uerr)
		}
	}
	if pe := plugin.AsError(err); err != nil && ctx.Err() == nil && pe.Code == plugin.CodeRateLimited {
		s.mu.Lock()
		s.pause(s.stateOf(inst), pe, s.clock())
		s.mu.Unlock()
	}
	return nzb, err
}

func (s *Service) plugin(inst instances.Instance) (indexer.Indexer, bool) {
	p, _, ok := s.inst.Registry().Lookup(inst.PluginID)
	if !ok {
		return nil, false
	}
	ix, ok := p.(indexer.Indexer)
	return ix, ok
}

// lane runs one indexer's whole search.
func (s *Service) lane(ctx context.Context, inst instances.Instance, q Query) (out []Release, failure *Failure) {
	p, ok := s.plugin(inst)
	if !ok {
		return nil, &Failure{IndexerID: inst.ID, IndexerName: inst.Name, Code: plugin.CodeInvalid, Message: "the indexer's plugin is not installed"}
	}
	fail := func(err error) *Failure { return failureOf(ctx, inst, err) }
	tag := func(byID bool, rels []indexer.Release) {
		for _, r := range rels {
			out = append(out, Release{Release: r, IndexerID: inst.ID, IndexerName: inst.Name, IndexerPriority: inst.Priority, ByID: byID})
		}
	}
	seen := map[string]bool{}
	fresh := func(rels []indexer.Release) []indexer.Release {
		var keep []indexer.Release
		for _, r := range rels {
			if !seen[r.GUID] {
				seen[r.GUID] = true
				keep = append(keep, r)
			}
		}
		return keep
	}

	caps := s.capsOf(ctx, p, inst)
	if byID, ok := idQuery(q, caps); ok {
		rels, err := s.page(ctx, p, inst, byID, caps)
		tag(true, fresh(rels))
		if err != nil {
			return out, fail(err)
		}
		if len(rels) > 0 {
			return out, nil
		}
	}
	for _, text := range textQueries(q) {
		rels, err := s.page(ctx, p, inst, indexer.SearchQuery{
			Media: q.Media, Mode: indexer.ModeText, Text: text, Season: q.Season, Episode: q.Episode,
		}, caps)
		tag(false, fresh(rels))
		if err != nil {
			return out, fail(err)
		}
	}
	return out, nil
}

// capsOf returns the indexer's Caps from the cache, reading them when they are
// missing, a week old or were read with another config. An indexer whose Caps
// cannot be read is searched with the usual defaults and not disabled; the
// search itself reports a real problem.
func (s *Service) capsOf(ctx context.Context, p indexer.Indexer, inst instances.Instance) indexer.Caps {
	fp := fmt.Sprint(inst.Config)
	s.mu.Lock()
	c, ok := s.caps[inst.ID]
	s.mu.Unlock()
	if ok && c.cfg == fp && s.clock().Sub(c.at) < capsTTL {
		return c.caps
	}
	caps, err := p.Caps(ctx, inst.Connection())
	if err != nil {
		return defaultCaps
	}
	s.mu.Lock()
	s.caps[inst.ID] = cachedCaps{caps: caps, at: s.clock(), cfg: fp}
	s.mu.Unlock()
	return caps
}

// defaultCaps is what an indexer is assumed to offer when it will not say.
var defaultCaps = indexer.Caps{
	PageSize: defaultPage,
	Text:     indexer.SearchCaps{Available: true, Params: []string{"q"}},
	Movie:    indexer.SearchCaps{Available: true, Params: []string{"q", "imdbid"}},
	TV:       indexer.SearchCaps{Available: true, Params: []string{"q", "tvdbid", "season", "ep"}},
}

func supports(c indexer.SearchCaps, param string) bool {
	if len(c.Params) == 0 {
		return true
	}
	for _, p := range c.Params {
		if p == param {
			return true
		}
	}
	return false
}

// idQuery builds the ID search the indexer can serve, if any.
func idQuery(q Query, caps indexer.Caps) (indexer.SearchQuery, bool) {
	sc := caps.Movie
	if q.Media == indexer.MediaTV {
		sc = caps.TV
	}
	if !sc.Available {
		return indexer.SearchQuery{}, false
	}
	out := indexer.SearchQuery{Media: q.Media, Mode: indexer.ModeIDs, Season: q.Season, Episode: q.Episode}
	if q.IMDBID != "" && supports(sc, "imdbid") {
		out.IMDBID = q.IMDBID
	}
	if q.TMDBID != 0 && len(sc.Params) > 0 && supports(sc, "tmdbid") {
		out.TMDBID = q.TMDBID
	}
	if q.TVDBID != 0 && supports(sc, "tvdbid") {
		out.TVDBID = q.TVDBID
	}
	if out.IMDBID == "" && out.TMDBID == 0 && out.TVDBID == 0 {
		return indexer.SearchQuery{}, false
	}
	return out, true
}

// textQueries are the free-text searches for the Titles, without repeats.
func textQueries(q Query) []string {
	var out []string
	seen := map[string]bool{}
	for _, t := range q.Titles {
		t = strings.Join(strings.Fields(t), " ")
		if t == "" {
			continue
		}
		if q.Media == indexer.MediaMovie && q.Year > 0 {
			t = fmt.Sprintf("%s %d", t, q.Year)
		}
		if key := strings.ToLower(t); !seen[key] {
			seen[key] = true
			out = append(out, t)
		}
	}
	return out
}

// page runs q until the indexer has no more, keeping what it gave before an error.
func (s *Service) page(ctx context.Context, p indexer.Indexer, inst instances.Instance, q indexer.SearchQuery, caps indexer.Caps) ([]indexer.Release, error) {
	limit := cmpFirst(caps.MaxPageSize, caps.PageSize, defaultPage)
	var out []indexer.Release
	for range maxPages {
		q.Limit, q.Offset = limit, len(out)
		res, err := s.askSearch(ctx, p, inst, q)
		if err != nil {
			return out, err
		}
		out = append(out, res.Releases...)
		if len(res.Releases) < limit || (res.Total > 0 && len(out) >= res.Total) {
			break
		}
	}
	return out, nil
}

func cmpFirst(ns ...int) int {
	for _, n := range ns {
		if n > 0 {
			return n
		}
	}
	return 0
}
