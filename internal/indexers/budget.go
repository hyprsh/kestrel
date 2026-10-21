package indexers

import (
	"context"
	"fmt"
	"time"

	"github.com/hyprsh/kestrel/internal/plugin"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
)

// Budgets, pacing and pauses (PRD Settled 14, #12). Every request a lane makes
// goes through askSearch, and every NZB fetch through Fetch, so the host
// alone decides when an indexer may be asked:
//
//   - 500 (a plugin.Error with Limit "search") pauses searches, RSS included;
//     501 (Limit "grab") pauses Grabs; a bare 429 pauses both. A pause lasts
//     until the Retry-After the indexer gave, else an hour.
//   - An indexer that reports grabcurrent >= grabmax has its Grabs paused.
//   - A sweep (see WithSweep) stops at 80 % of the daily search budget: the
//     indexer's own apilimits when it reports them, else the instance's
//     api_requests_per_day. With neither, sweeps pace themselves to one
//     request per 10 s. RSS, Grabs and manual searches ignore the 80 % rule.
//   - Any other error backs the indexer off, escalating with each failure in
//     a row.
//
// State lives in memory: a restart forgets pauses (the indexer simply says so
// again) and the local request count (the indexer's own report, when it gives
// one, takes over at its next answer).
const (
	// sweepShare is the share of the daily search budget a sweep may use, in percent.
	sweepShare = 80
	// defaultPause is how long a limit pauses an indexer that gave no Retry-After.
	defaultPause = time.Hour
	// sweepGap is the spacing of sweep requests to an indexer with no known limit.
	sweepGap = 10 * time.Second
	// reportTTL is how long an indexer's reported quota is believed; RSS refreshes it every 15 min.
	reportTTL = time.Hour
)

// errorBackoff is how long an indexer is left alone after its n-th failure in
// a row (Radarr's escalation).
var errorBackoff = []time.Duration{
	0, time.Minute, 5 * time.Minute, 15 * time.Minute, 30 * time.Minute,
	time.Hour, 3 * time.Hour, 6 * time.Hour, 12 * time.Hour, 24 * time.Hour,
}

type sweepKey struct{}

// WithSweep marks ctx as a sweep's: its searches obey the 80 % stop and the
// pacing, which RSS, Grabs and manual searches do not.
func WithSweep(ctx context.Context) context.Context { return context.WithValue(ctx, sweepKey{}, true) }

func isSweep(ctx context.Context) bool { v, _ := ctx.Value(sweepKey{}).(bool); return v }

// state is what the host remembers of one indexer.
type state struct {
	cfg                    string // fingerprint of the config the rest was learned under
	searchUntil, grabUntil time.Time

	day  int64 // UTC day of used
	used int   // search requests made on that day

	reported   indexer.Limits
	reportedAt time.Time

	sweepNext time.Time // when the next sweep request may go out (no known limit)

	failures     int
	backoffUntil time.Time
	last         *plugin.Error
}

func (s *Service) stateOf(inst instances.Instance) *state {
	fp := fmt.Sprint(inst.Config)
	st := s.states[inst.ID]
	if st == nil {
		st = &state{cfg: fp}
		s.states[inst.ID] = st
	}
	if st.cfg != fp { // the admin changed the connection: start afresh
		*st = state{cfg: fp, used: st.used, day: st.day, searchUntil: st.searchUntil, grabUntil: st.grabUntil, reported: st.reported, reportedAt: st.reportedAt}
	}
	return st
}

func (st *state) roll(now time.Time) {
	if d := now.UTC().Unix() / 86400; d != st.day {
		st.day, st.used = d, 0
	}
}

// budget is the daily search budget in force: used and max, max 0 when unknown.
func (st *state) budget(now time.Time, configured int) (used, max int) {
	st.roll(now)
	if st.reported.Reported && st.reported.APIMax > 0 && now.Sub(st.reportedAt) < reportTTL {
		return st.reported.APICurrent, st.reported.APIMax
	}
	return st.used, configured
}

func (st *state) grabQuotaSpent(now time.Time) bool {
	l := st.reported
	return l.Reported && l.GrabMax > 0 && l.GrabCurrent >= l.GrabMax && now.Sub(st.reportedAt) < reportTTL
}

func pausedErr(limit string, until, now time.Time, msg string) *plugin.Error {
	return &plugin.Error{Code: plugin.CodeRateLimited, Message: msg, RetryAfter: until.Sub(now), Limit: limit}
}

// gateSearch decides whether a search request may go out now. A non-nil error
// says why not; wait is how long a sweep request must hold back first.
func (s *Service) gateSearch(ctx context.Context, inst instances.Instance) (wait time.Duration, err *plugin.Error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.clock()
	st := s.stateOf(inst)
	if st.searchUntil.After(now) {
		return 0, pausedErr(plugin.LimitSearch, st.searchUntil, now, "searches are paused: the indexer's request limit was reached")
	}
	if st.backoffUntil.After(now) && st.last != nil {
		return 0, &plugin.Error{Code: st.last.Code, Message: st.last.Message}
	}
	if !isSweep(ctx) {
		return 0, nil
	}
	used, max := st.budget(now, inst.Connection().Int("api_requests_per_day"))
	if max > 0 {
		if used*100 >= max*sweepShare {
			return 0, pausedErr(plugin.LimitSearch, now, now, fmt.Sprintf("sweeps stop at %d %% of the daily search budget (%d of %d used)", sweepShare, used, max))
		}
		return 0, nil
	}
	start := st.sweepNext
	if start.Before(now) {
		start = now
	}
	st.sweepNext = start.Add(sweepGap)
	return start.Sub(now), nil
}

// noteSearch records how one search request went.
func (s *Service) noteSearch(ctx context.Context, inst instances.Instance, res indexer.SearchResult, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.clock()
	st := s.stateOf(inst)
	st.roll(now)
	st.used++
	if res.Limits.Reported {
		st.reported, st.reportedAt = res.Limits, now
	}
	if err == nil {
		st.failures, st.backoffUntil, st.last = 0, time.Time{}, nil
		return
	}
	if ctx.Err() != nil {
		return
	}
	pe := plugin.AsError(err)
	switch {
	case pe.Code == plugin.CodeRateLimited:
		s.pause(st, pe, now)
	case pe.Code == plugin.CodeNotFound:
	default:
		st.failures++
		st.backoffUntil = now.Add(errorBackoff[min(st.failures, len(errorBackoff))-1])
		st.last = pe
	}
}

// pause applies a rate_limited Error to the kinds of request it covers.
func (s *Service) pause(st *state, pe *plugin.Error, now time.Time) {
	d := pe.RetryAfter
	if d <= 0 {
		d = defaultPause
	}
	until := now.Add(d)
	if pe.Limit != plugin.LimitGrab {
		st.searchUntil = until
	}
	if pe.Limit != plugin.LimitSearch {
		st.grabUntil = until
	}
}

// CanSweep reports whether a sweep could search at all now: some enabled
// indexer is neither paused, backing off nor at the 80 % stop. With no
// enabled indexer it is true, so the sweep's own reporting stays as it was.
func (s *Service) CanSweep(ctx context.Context) bool {
	enabled, err := s.inst.Enabled(ctx, indexer.Contract.ID)
	if err != nil || len(enabled) == 0 {
		return true
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.clock()
	for _, inst := range enabled {
		st := s.stateOf(inst)
		if st.searchUntil.After(now) || (st.backoffUntil.After(now) && st.last != nil) {
			continue
		}
		if used, max := st.budget(now, inst.Connection().Int("api_requests_per_day")); max > 0 && used*100 >= max*sweepShare {
			continue
		}
		return true
	}
	return false
}

// GrabsPaused reports whether the indexer's Grabs are paused now: by a 501 or
// a bare 429 that has not run out, or by a spent download quota it reported.
func (s *Service) GrabsPaused(indexerID int64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.states[indexerID]
	if st == nil {
		return false
	}
	now := s.clock()
	return st.grabUntil.After(now) || st.grabQuotaSpent(now)
}

// Status is an indexer's budget and pauses, for the health strip.
type Status struct {
	// SearchUsed is the search requests made today and SearchMax the daily
	// budget; SearchMax is 0 when there is none to know.
	SearchUsed, SearchMax int
	// GrabUsed and GrabMax are the indexer's own download quota, 0 when it reports none.
	GrabUsed, GrabMax int
	// SearchPausedUntil and GrabsPausedUntil are zero when not paused. A spent
	// download quota reports GrabsPaused with no end.
	SearchPausedUntil, GrabsPausedUntil time.Time
	GrabsPaused                         bool
	// BackoffUntil is when an indexer that keeps failing is tried again; zero when it is not backing off.
	BackoffUntil time.Time
	// SweepsStopped says the sweeps have used their 80 % of the daily search
	// budget: they leave the indexer alone until the day (UTC) or its own count rolls over.
	SweepsStopped bool
}

// Status reads the indexer's budget and pauses. configured is its
// api_requests_per_day setting, 0 when blank.
func (s *Service) Status(indexerID int64, configured int) Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.states[indexerID]
	if st == nil {
		return Status{SearchMax: configured}
	}
	now := s.clock()
	var out Status
	out.SearchUsed, out.SearchMax = st.budget(now, configured)
	out.SweepsStopped = out.SearchMax > 0 && out.SearchUsed*100 >= out.SearchMax*sweepShare
	if st.reported.Reported && now.Sub(st.reportedAt) < reportTTL {
		out.GrabUsed, out.GrabMax = st.reported.GrabCurrent, st.reported.GrabMax
	}
	if st.searchUntil.After(now) {
		out.SearchPausedUntil = st.searchUntil
	}
	if st.grabUntil.After(now) {
		out.GrabsPausedUntil = st.grabUntil
	}
	out.GrabsPaused = !out.GrabsPausedUntil.IsZero() || st.grabQuotaSpent(now)
	if st.backoffUntil.After(now) {
		out.BackoffUntil = st.backoffUntil
	}
	return out
}

// askSearch makes one search request to an indexer, if the host lets it.
func (s *Service) askSearch(ctx context.Context, p indexer.Indexer, inst instances.Instance, q indexer.SearchQuery) (indexer.SearchResult, error) {
	wait, perr := s.gateSearch(ctx, inst)
	if perr != nil {
		return indexer.SearchResult{}, perr
	}
	if wait > 0 {
		if err := s.sleep(ctx, wait); err != nil {
			return indexer.SearchResult{}, err
		}
	}
	res, err := p.Search(ctx, inst.Connection(), q)
	s.noteSearch(ctx, inst, res, err)
	return res, err
}

func sleepFor(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// SetSleep replaces how sweep pacing waits, for tests.
func (s *Service) SetSleep(f func(ctx context.Context, d time.Duration) error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sleep = f
}
