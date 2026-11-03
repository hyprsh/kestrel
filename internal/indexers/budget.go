package indexers

import (
	"context"
	"fmt"
	"time"

	idb "github.com/hyprsh/kestrel/internal/indexers/db"
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
//
//   - An indexer that reports grabcurrent >= grabmax has its Grabs paused.
//
//   - A sweep (see WithSweep) stops at 80 % of the daily search budget: the
//     indexer's own apilimits when it reports them, else the instance's
//     api_requests_per_day. With neither, sweeps pace themselves to one
//     request per 10 s. RSS, Grabs and manual searches ignore the 80 % rule.
//
//   - Every search request (RSS and Grab downloads excepted) keeps a minimum
//     gap from the one before it to the same indexer: the instance's
//     search_gap_seconds, 2 s when it has none. Requests queue on it, one
//     indexer at a time; different indexers run in parallel. A manual search
//     uses half the gap, never under 1 s, and a sweep the longer of the gap
//     and its own 10 s. An indexer that answers much slower than usual gets
//     the gap doubled, up to 30 s, and it halves again with each quick answer.
//
//   - Any other error backs the indexer off, escalating with each failure in
//     a row.
//
//   - An instance's grabs_per_day (Grabs per day) caps the Grabs whose NZB the
//     indexer handed over per UTC day. Kestrel counts them itself, in the
//     indexer_grab_counts table, so the count survives a restart and a
//     cancelled Grab still counts. At the limit Grabs pause until the next UTC
//     midnight. A current reported grabmax decides on its own and the
//     configured limit is ignored.
//
// Apart from that count, state lives in memory: a restart forgets pauses (the
// indexer simply says so again) and the local request count (the indexer's
// own report, when it gives one, takes over at its next answer).
const (
	// sweepShare is the share of the daily search budget a sweep may use, in percent.
	sweepShare = 80
	// defaultPause is how long a limit pauses an indexer that gave no Retry-After.
	defaultPause = time.Hour
	// sweepGap is the spacing of sweep requests to an indexer with no known limit.
	sweepGap = 10 * time.Second
	// defaultSearchGap is the gap of an indexer whose instance sets none.
	defaultSearchGap = 2 * time.Second
	// manualGapFloor is the shortest gap a manual search keeps, when there is a gap at all.
	manualGapFloor = time.Second
	// slowFactor and slowFloor say when an answer is slow: longer than slowFactor times the usual one and slowFloor.
	slowFactor = 3
	slowFloor  = 5 * time.Second
	// maxGap is the widest gap slow answers can ask for.
	maxGap = 30 * time.Second
	// usualSamples is how many answers the usual time is learned from before one can be called slow.
	usualSamples = 3
	// reportTTL is how long an indexer's reported quota is believed; RSS refreshes it every 15 min.
	reportTTL = time.Hour
)

// SearchGapKey is the indexer instance setting for the minimum seconds between
// two search requests to it; blank means defaultSearchGap, 0 no gap.
const SearchGapKey = "search_gap_seconds"

// GrabsPerDayKey is the indexer instance setting that caps its Grabs per UTC
// day; blank or 0 means no cap.
const GrabsPerDayKey = "grabs_per_day"

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

type manualKey struct{}

// WithManual marks ctx as a manual search's: the admin is waiting, so its
// requests keep half the gap (never under 1 s) and are never answered from
// what an earlier whole-Series request returned.
func WithManual(ctx context.Context) context.Context {
	return context.WithValue(ctx, manualKey{}, true)
}

func isManual(ctx context.Context) bool { v, _ := ctx.Value(manualKey{}).(bool); return v }

// SearchGap is the gap the instance sets between its search requests.
func SearchGap(inst instances.Instance) time.Duration {
	switch inst.Config[SearchGapKey].(type) {
	case float64, int, int64:
		return max(time.Duration(inst.Connection().Int(SearchGapKey))*time.Second, 0)
	}
	return defaultSearchGap
}

// state is what the host remembers of one indexer.
type state struct {
	cfg                    string // fingerprint of the config the rest was learned under
	searchUntil, grabUntil time.Time

	day  int64 // UTC day of used
	used int   // search requests made on that day

	reported   indexer.Limits
	reportedAt time.Time

	lastStart time.Time     // when the latest search request was let go, or is queued to go
	widened   time.Duration // the gap slow answers asked for; 0 when none
	usual     time.Duration // the usual answer time (moving average)
	answers   int           // answers it is learned from

	seasons seasonMemory

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
		*st = state{cfg: fp, used: st.used, day: st.day, searchUntil: st.searchUntil, grabUntil: st.grabUntil, reported: st.reported, reportedAt: st.reportedAt,
			lastStart: st.lastStart, widened: st.widened, usual: st.usual, answers: st.answers}
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

// reportedGrabQuota says the indexer's own download quota is current and
// decides on its own: the configured Grabs per day is then ignored.
func (st *state) reportedGrabQuota(now time.Time) bool {
	l := st.reported
	return l.Reported && l.GrabMax > 0 && now.Sub(st.reportedAt) < reportTTL
}

// utcDay is the UTC day of t, counted from the Unix epoch.
func utcDay(t time.Time) int64 { return t.UTC().Unix() / 86400 }

// nextUTCMidnight is the start of the UTC day after t's.
func nextUTCMidnight(t time.Time) time.Time { return time.Unix((utcDay(t)+1)*86400, 0).UTC() }

// grabsToday is how many Grabs the indexer has handed an NZB for today (UTC).
// A store that cannot answer counts as none, so a broken table never blocks
// Grabs. It reads the store: call it without s.mu.
func (s *Service) grabsToday(ctx context.Context, indexerID int64, now time.Time) int {
	n, err := idb.New(s.st.Read()).GrabCount(ctx, idb.GrabCountParams{IndexerID: indexerID, Day: utcDay(now)})
	if err != nil {
		s.log.Warn("indexers: cannot read today's Grab count; the Grabs per day are not applied", "indexer_id", indexerID, "err", err)
		return 0
	}
	return int(n)
}

// configuredGrabLimit is the Grabs per day in force for an indexer: its
// grabs_per_day, or 0 when that is blank or a current download quota the
// indexer reports decides instead. st is nil when nothing has been learned of
// the indexer since the start.
func configuredGrabLimit(st *state, grabsPerDay int, now time.Time) int {
	if grabsPerDay <= 0 || (st != nil && st.reportedGrabQuota(now)) {
		return 0
	}
	return grabsPerDay
}

// grabLimitSpent reads today's Grab count against limit, a configuredGrabLimit:
// spent once the count has reached it, never when limit is 0. It reads the
// store: call it without s.mu.
func (s *Service) grabLimitSpent(ctx context.Context, indexerID int64, limit int, now time.Time) (count int, spent bool) {
	if limit <= 0 {
		return 0, false
	}
	count = s.grabsToday(ctx, indexerID, now)
	return count, count >= limit
}

func pausedErr(limit string, until, now time.Time, msg string) *plugin.Error {
	return &plugin.Error{Code: plugin.CodeRateLimited, Message: msg, RetryAfter: until.Sub(now), Limit: limit}
}

// gateSearch decides whether a search request may go out now. A non-nil error
// says why not; wait is how long the request must hold back first, on the gap
// to the indexer's previous request. The wait is reserved: the next request
// queues behind it. RSS reads keep no gap.
func (s *Service) gateSearch(ctx context.Context, inst instances.Instance, q indexer.SearchQuery) (wait time.Duration, err *plugin.Error) {
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
	var gap time.Duration
	switch {
	case isSweep(ctx):
		used, budget := st.budget(now, inst.Connection().Int("api_requests_per_day"))
		if budget > 0 && used*100 >= budget*sweepShare {
			return 0, pausedErr(plugin.LimitSearch, now, now, fmt.Sprintf("sweeps stop at %d %% of the daily search budget (%d of %d used)", sweepShare, used, budget))
		}
		gap = st.gap(inst)
		if budget == 0 {
			gap = max(gap, sweepGap)
		}
	case isManual(ctx):
		gap = manualGap(st.gap(inst))
	default:
		gap = st.gap(inst)
	}
	if q.Mode == indexer.ModeRSS {
		return 0, nil
	}
	start := st.lastStart.Add(gap)
	if start.Before(now) {
		start = now
	}
	st.lastStart = start
	return start.Sub(now), nil
}

// gap is the gap in force: the configured one, or the wider one slow answers asked for.
func (st *state) gap(inst instances.Instance) time.Duration {
	return max(SearchGap(inst), st.widened)
}

// manualGap is the gap a manual search keeps for a gap g: half of it, not under a second, none for none.
func manualGap(g time.Duration) time.Duration {
	if g <= 0 {
		return 0
	}
	return max(g/2, manualGapFloor)
}

// noteSearch records how one search request went.
func (s *Service) noteSearch(ctx context.Context, inst instances.Instance, res indexer.SearchResult, err error, took time.Duration) {
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
		st.noteAnswerTime(took, SearchGap(inst))
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

// noteAnswerTime learns from how long an answer took. One that takes over
// slowFactor times the usual time and over slowFloor is slow: it doubles the
// gap (the configured one at first), up to maxGap, and does not count towards
// the usual time, so an indexer that stays slow keeps its wide gap. Each other
// answer halves the widened gap, until it is back down to the configured one.
func (st *state) noteAnswerTime(took, configured time.Duration) {
	if st.answers >= usualSamples && took > slowFloor && took > slowFactor*st.usual {
		st.widened = min(max(st.widened, configured, time.Second)*2, maxGap)
		return
	}
	if st.widened > 0 {
		if st.widened /= 2; st.widened <= configured {
			st.widened = 0
		}
	}
	if st.answers == 0 {
		st.usual = took
	} else {
		st.usual += (took - st.usual) / 5
	}
	st.answers++
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
// a bare 429 that has not run out, by a spent download quota it reported, or,
// when it reports none, by its configured Grabs per day being used up.
func (s *Service) GrabsPaused(indexerID int64) bool {
	ctx := context.Background()
	grabsPerDay := 0
	if inst, err := s.inst.Get(ctx, indexerID); err == nil {
		grabsPerDay = inst.Connection().Int(GrabsPerDayKey)
	}
	s.mu.Lock()
	now := s.clock()
	st := s.states[indexerID]
	if st != nil && (st.grabUntil.After(now) || st.grabQuotaSpent(now)) {
		s.mu.Unlock()
		return true
	}
	limit := configuredGrabLimit(st, grabsPerDay, now)
	s.mu.Unlock()
	_, spent := s.grabLimitSpent(ctx, indexerID, limit, now)
	return spent
}

// Status is an indexer's budget and pauses, for the health strip.
type Status struct {
	// SearchUsed is the search requests made today and SearchMax the daily
	// budget; SearchMax is 0 when there is none to know.
	SearchUsed, SearchMax int
	// GrabUsed and GrabMax are the indexer's own download quota or, when it
	// reports none, the configured Grabs per day and today's count; 0 when neither.
	GrabUsed, GrabMax int
	// SearchPausedUntil and GrabsPausedUntil are zero when not paused. A spent
	// download quota reported by the indexer reports GrabsPaused with no end; a
	// spent configured limit ends at the next UTC midnight.
	SearchPausedUntil, GrabsPausedUntil time.Time
	GrabsPaused                         bool
	// BackoffUntil is when an indexer that keeps failing is tried again; zero when it is not backing off.
	BackoffUntil time.Time
	// Gap is the minimum time between two search requests to the indexer now, and
	// Widened says slow answers have made it longer than the configured one.
	Gap     time.Duration
	Widened bool
	// WaitUntil is when the last search request queued on the gap is let go; zero when none waits.
	WaitUntil time.Time
	// SweepsStopped says the sweeps have used their 80 % of the daily search
	// budget: they leave the indexer alone until the day (UTC) or its own count rolls over.
	SweepsStopped bool
}

// Status reads the indexer's budget and pauses. apiRequestsPerDay and
// grabsPerDay are its api_requests_per_day and grabs_per_day settings, 0 when
// blank, and searchGap its SearchGap. Both apply before the indexer has been asked anything since the start.
func (s *Service) Status(indexerID int64, apiRequestsPerDay, grabsPerDay int, searchGap time.Duration) Status {
	s.mu.Lock()
	now := s.clock()
	st := s.states[indexerID]
	if st == nil {
		st = &state{} // nothing learned yet; not kept, so the first contact starts afresh
	}
	var out Status
	out.SearchUsed, out.SearchMax = st.budget(now, apiRequestsPerDay)
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
	out.Gap = max(searchGap, st.widened)
	out.Widened = st.widened > searchGap
	if st.lastStart.After(now) {
		out.WaitUntil = st.lastStart
	}
	quotaSpent := st.grabQuotaSpent(now)
	if st.backoffUntil.After(now) {
		out.BackoffUntil = st.backoffUntil
	}
	limit := configuredGrabLimit(st, grabsPerDay, now)
	s.mu.Unlock()

	if limit > 0 {
		count, spent := s.grabLimitSpent(context.Background(), indexerID, limit, now)
		out.GrabUsed, out.GrabMax = count, limit
		if spent && out.GrabsPausedUntil.IsZero() {
			out.GrabsPausedUntil = nextUTCMidnight(now)
		}
	}
	out.GrabsPaused = !out.GrabsPausedUntil.IsZero() || quotaSpent
	return out
}

// askSearch makes one search request to an indexer, if the host lets it.
func (s *Service) askSearch(ctx context.Context, p indexer.Indexer, inst instances.Instance, q indexer.SearchQuery) (indexer.SearchResult, error) {
	wait, perr := s.gateSearch(ctx, inst, q)
	if perr != nil {
		return indexer.SearchResult{}, perr
	}
	if wait > 0 {
		if err := s.sleep(ctx, wait); err != nil {
			return indexer.SearchResult{}, err
		}
	}
	start := s.clock()
	res, err := p.Search(ctx, inst.Connection(), q)
	s.noteSearch(ctx, inst, res, err, s.clock().Sub(start))
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
