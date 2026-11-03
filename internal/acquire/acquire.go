package acquire

import (
	"cmp"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"sync"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire/db"
	"github.com/hyprsh/kestrel/internal/downloads"
	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/indexers"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/plugin"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/resolution"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
	"github.com/hyprsh/kestrel/internal/slot"
	"github.com/hyprsh/kestrel/internal/store"
)

// CacheTTL is how long a search's Releases stay grabbable. A Grab, a retry
// after a failure and a manual Grab all pick from this cache.
const CacheTTL = 6 * time.Hour

var (
	// ErrReleaseExpired means the Release is not in the candidate cache (it
	// is older than CacheTTL, or was never a result for this Title): search again.
	ErrReleaseExpired = errors.New("the release is no longer in the search results")
	// ErrReleaseGone means the indexer no longer has the Release's NZB.
	ErrReleaseGone = errors.New("the indexer no longer has the release")
)

// RejectedError is a Grab refused because of the Release's rejections.
type RejectedError struct {
	Rejections []scoring.Rejection
}

func (e *RejectedError) Error() string { return fmt.Sprintf("release rejected: %v", e.Rejections) }

// NotOverridable is true when at least one rejection can never be overridden
// (blocklisted, other_slot, season_not_listed): no "Grab anyway" for this Release.
func (e *RejectedError) NotOverridable() bool {
	return slices.ContainsFunc(e.Rejections, func(r scoring.Rejection) bool { return !Overridable(r) })
}

// Overridable says whether "Grab anyway" may override the rejection. Every
// code can be except blocklisted, other_slot and season_not_listed.
func Overridable(r scoring.Rejection) bool {
	return r != scoring.RejectBlocklisted && r != RejectOtherSlot &&
		r != RejectSeasonNotListed
}

// Library is what acquire reads from the library module.
type Library interface {
	TitleOfVersion(ctx context.Context, versionID int64) (int64, error)
	Get(ctx context.Context, id int64, view library.View) (library.Detail, error)
	// Names and Episodes serve RSS: the Titles to match a feed to and a Series' episodes.
	Names(ctx context.Context) ([]library.Named, error)
	Episodes(ctx context.Context, titleID int64, view library.View) ([]library.Episode, error)
	// MarkReleaseSeen records a Release seen for a Movie with no release date anywhere.
	MarkReleaseSeen(ctx context.Context, titleID int64, at time.Time) error
	// AddPlaceholders adds Placeholder Episodes for a Grab to cover.
	AddPlaceholders(ctx context.Context, titleID int64, refs []library.EpisodeRef) error
	// MarkMissingSearchedIn counts a completed search that was not the sweep's as the Version's search for
	// its cadence (the rows of the seasons given, else all).
	MarkMissingSearchedIn(ctx context.Context, versionID int64, at time.Time, failed bool, seasons []int) error
	// NoteRejection and ClearRejections keep the cooldown of the retries a rejected Import or a Cancel with
	// blocklist start.
	NoteRejection(ctx context.Context, versionID int64, at time.Time) (library.Retry, error)
	ClearRejections(ctx context.Context, versionID int64) error
}

// Profiles is what acquire reads from the scoring module's settings.
type Profiles interface {
	List(ctx context.Context) ([]profiles.Profile, error)
	Region(ctx context.Context) (profiles.Region, bool, error)
}

// Indexers is the indexers host.
type Indexers interface {
	Search(ctx context.Context, q indexers.Query) indexers.Result
	// SearchGroup is Search over the indexers of one Indexer Priority, and Priorities are those priorities,
	// lowest first: the groups an automatic search asks in turn.
	SearchGroup(ctx context.Context, q indexers.Query, priority int) indexers.Result
	Priorities(ctx context.Context) []int
	RSS(ctx context.Context) indexers.Result
	Fetch(ctx context.Context, indexerID int64, downloadURL string) ([]byte, error)
	// GrabsPaused says whether the indexer's Grabs are paused: Decide skips its Releases.
	GrabsPaused(indexerID int64) bool
	// CanSweep says whether a sweep could ask any indexer now (the 80 % stop, pauses).
	CanSweep(ctx context.Context) bool
	// Enabled is how many indexers a search asks.
	Enabled(ctx context.Context) int
	// MarkFit records which indexers' lanes of a Search returned a Release that fit a Slot.
	MarkFit(ctx context.Context, searches map[int64]int64, fitting map[int64]bool)
}

// Downloads is the downloads host.
type Downloads interface {
	Add(ctx context.Context, job downloads.Job) (downloads.Sent, error)
	List(ctx context.Context) ([]downloads.Listed, error)
	Remove(ctx context.Context, instanceID int64, clientID string, deleteData bool) error
}

// Deps are what a Service needs; modules take their dependencies as interfaces.
type Deps struct {
	Store     *store.Store
	Clock     func() time.Time
	Library   Library
	Profiles  Profiles
	Indexers  Indexers
	Downloads Downloads
	// History records the events the UI must see; nil records nothing.
	History *history.Service
	// Snapshot is the TRaSH data to score with; nil means the one embedded in the binary.
	Snapshot *scoring.Snapshot
	// Scoring is the live TRaSH snapshot; it wins over Snapshot. A swap drops the
	// candidate cache and waits for decisions in flight (Settled 6).
	Scoring *scoring.Holder
	// Pause is the Pause Grabs switch; nil never pauses.
	Pause GrabPause
	// Slots reads the stored Slots, whose labels the Log and the Activity name them by; nil names a Slot by its id.
	Slots SlotLabels
}

// SlotLabels reads the stored Slots (ADR 0024). *slots.Service satisfies it.
type SlotLabels interface {
	List(ctx context.Context) ([]slot.Record, error)
}

// GrabPause says whether automatic Grabs are paused (see Pause).
type GrabPause interface {
	Paused(ctx context.Context) (bool, error)
}

// Service searches for Releases and grabs them.
type Service struct {
	st    *store.Store
	clock func() time.Time
	lib   Library
	prof  Profiles
	idx   Indexers
	dl    Downloads
	snap  *scoring.Holder
	cache *cache
	live  *liveSet
	hist  *history.Service
	// misses counts, per Grab, the polls in a row that did not find its job.
	misses *missCount
	pause  GrabPause
	slots  SlotLabels
	// searches runs the searches started by hand, two at a time.
	searches *background
	// searching admits one search of a Version at a time; granting serialises the check-and-record of a Version's
	// Grabs. See keyedLock for the lock order.
	searching, granting *keyedLock
}

// New returns a Service.
func New(d Deps) (*Service, error) {
	if d.Clock == nil {
		d.Clock = time.Now
	}
	if d.Scoring == nil {
		if d.Snapshot == nil {
			snap, err := scoring.Embedded()
			if err != nil {
				return nil, err
			}
			d.Snapshot = snap
		}
		d.Scoring = scoring.NewHolder(d.Snapshot)
	}
	svc := &Service{
		st: d.Store, clock: d.Clock, lib: d.Library, prof: d.Profiles, idx: d.Indexers, dl: d.Downloads,
		snap: d.Scoring, cache: newCache(), live: &liveSet{m: map[int64]Live{}}, hist: d.History, misses: &missCount{m: map[int64]int{}},
		pause: d.Pause, slots: d.Slots, searches: newBackground(2), searching: newKeyedLock(), granting: newKeyedLock(),
	}
	d.Scoring.OnSwap(func() {
		svc.cache.reset()
	})
	return svc, nil
}

func ts(t time.Time) string { return t.UTC().Format(time.RFC3339) }

func parseTime(s string) time.Time {
	t, _ := time.Parse(time.RFC3339, s)
	return t
}

func nullID(n int64) sql.NullInt64 { return sql.NullInt64{Int64: n, Valid: n != 0} }

func b2i(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

// Fit says where a Release belongs relative to a Version.
type Fit string

const (
	FitsThisSlot  Fit = "this_slot"
	FitsOtherSlot Fit = "other_slot"
	// FitsNone is a Release whose resolution class is unknown.
	FitsNone Fit = "none"
)

// Reason is one rejection of a Release for a Version.
type Reason struct {
	Code        scoring.Rejection
	Overridable bool
}

// Found is a Release as one Version sees it.
type Found struct {
	// ID is opaque; it names the Release in the candidate cache for CacheTTL.
	ID          string
	GUID        string
	Name        string
	Indexer     string
	IndexerID   int64
	Size        int64
	PublishedAt time.Time
	Quality     string
	Languages   []string
	Formats     []scoring.MatchedFormat
	Score       int
	Fits        Fit
	Rejections  []Reason
	// Season, Episodes and Pack say what a Series Release holds: its season (the
	// first of a multi-season pack), the episodes of a single or multi-episode
	// release, and whether it is a season pack. Zero for a Movie.
	Season   int
	Episodes []int
	Pack     bool
	// VideoCodec, HDR, AudioCodec and AudioChannels are what the release name states; empty when it does not say.
	VideoCodec, HDR, AudioCodec, AudioChannels string
	// Group is the release group, as the indexer says or else as the name ends; empty when it has none.
	Group string
	// InfoURL is the indexer's page for the Release, and Grabs how often the indexer says it was grabbed; empty and 0 when it does not say.
	InfoURL string
	Grabs   int
	// Covers says, for each episode a Series Release holds that the library knows (or for the Movie itself),
	// whether this Version Wants it, already has a file for it, or neither, and the Score of that file.
	Covers []Cover
	// SizeLimit is the size limit the Version's Profile puts on this kind of Release, per Movie or (PerEpisode)
	// per episode of a Series; zero for none.
	SizeLimit  scoring.SizeLimit
	PerEpisode bool
}

// CoverState is where one thing a Release covers stands for the Version searched.
type CoverState string

const (
	CoverWanted CoverState = "wanted"
	CoverFilled CoverState = "filled"
	CoverOther  CoverState = "other" // not monitored, not out yet, or already downloading
)

// Cover is one episode a Release holds, or the Movie itself (Whole).
type Cover struct {
	Season, Episode int
	Whole           bool
	State           CoverState
	// FileScore is the Score of the file the Version holds for it, when there is one.
	FileScore *int
}

// SearchResult is the outcome of a manual search.
type SearchResult struct {
	// Items are every Release the indexers offered, best first: acceptable
	// ones before rejected, then by Score, then newest.
	Items []Found
	// Failures are the indexers that could not answer fully.
	Failures []indexers.Failure
	// SearchedAt is when the search ran and Indexers how many indexers it asked.
	SearchedAt time.Time
	Indexers   int
	// Cached is set when the list is an earlier answer of the indexers, given at SearchedAt, and no indexer was asked.
	Cached bool
	// Wanted is how many Units of the scope the Version searched Wants: the Wanted episodes, or 1 for a Wanted Movie.
	Wanted int
}

// entry is a Release in the candidate cache: the indexer's answer and its
// Verdict under every Version of the Title.
type entry struct {
	id      string
	titleID int64
	at      time.Time
	raw     indexers.Release
	cand    Candidate
	// rss is set for a Release an RSS read matched to the Title; it came from no search, and at is when the feed
	// first showed it.
	rss bool
}

type cache struct {
	mu sync.Mutex
	m  map[string]*entry
	// asked is when each group of indexers was last searched for a Title, so a retry from the cache knows which
	// groups' answers it holds even when a group found nothing.
	asked map[int64]map[group]time.Time
	// answers are the searches of a group that all its indexers answered, by Title, for a later search to reuse
	// (ReuseWindow). A failed group and the Releases of RSS are not in it.
	answers map[int64]map[group][]answer
}

func newCache() *cache {
	return &cache{m: map[string]*entry{}, asked: map[int64]map[group]time.Time{}, answers: map[int64]map[group][]answer{}}
}

// reset forgets every Release and answer.
func (c *cache) reset() {
	c.mu.Lock()
	c.m, c.asked, c.answers = map[string]*entry{}, map[int64]map[group]time.Time{}, map[int64]map[group][]answer{}
	c.mu.Unlock()
}

// put caches the Releases a search of the group g found for a Title.
func (c *cache) put(now time.Time, titleID int64, g group, es []*entry) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for id, e := range c.m {
		if now.Sub(e.at) >= CacheTTL {
			delete(c.m, id)
		}
	}
	for id, groups := range c.asked {
		for g, at := range groups {
			if now.Sub(at) >= CacheTTL {
				delete(groups, g)
			}
		}
		if len(groups) == 0 {
			delete(c.asked, id)
		}
	}
	for _, e := range es {
		c.m[e.id] = e
	}
	if c.asked[titleID] == nil {
		c.asked[titleID] = map[group]time.Time{}
	}
	c.asked[titleID][g] = now
}

// putFeed caches the Releases an RSS read matched to a Title. A feed is not a full answer, so no group or scope
// counts as asked; a Release the cache already holds for the Title (from a search, or an earlier read) is kept as it is.
func (c *cache) putFeed(now time.Time, titleID int64, es []*entry) {
	c.mu.Lock()
	defer c.mu.Unlock()
	have := map[string]bool{}
	for id, e := range c.m {
		if now.Sub(e.at) >= CacheTTL {
			delete(c.m, id)
		} else if e.titleID == titleID {
			have[entryKey(e.cand)] = true
		}
	}
	for _, e := range es {
		if k := entryKey(e.cand); !have[k] {
			have[k] = true
			e.rss = true
			c.m[e.id] = e
		}
	}
}

func (c *cache) get(now time.Time, id string) (*entry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.m[id]
	if !ok || now.Sub(e.at) >= CacheTTL {
		return nil, false
	}
	return e, true
}

// cachedFor returns the Releases the group g found for the Title that are still
// fresh in the cache and not on the Blocklist now, and whether the cache holds
// g's answer: it holds some Release of the Title, and one from g or a record
// that g (or every indexer) was asked. A Title with nothing cached is searched
// again whichever groups were asked.
func (s *Service) cachedFor(ctx context.Context, titleID int64, g group) ([]*entry, bool, error) {
	now := s.clock()
	c := s.cache
	c.mu.Lock()
	var all []*entry
	some := false
	for _, e := range c.m {
		if e.titleID == titleID && now.Sub(e.at) < CacheTTL {
			some = true
			if g.holds(e) {
				all = append(all, e)
			}
		}
	}
	fresh := func(g group) bool {
		at, ok := c.asked[titleID][g]
		return ok && now.Sub(at) < CacheTTL
	}
	held := some && (g.all || len(all) > 0 || fresh(g) || fresh(everyIndexer))
	c.mu.Unlock()
	slices.SortFunc(all, func(a, b *entry) int { return a.at.Compare(b.at) })
	var out []*entry
	for _, e := range all {
		blocked, err := s.blocklisted(ctx, e.raw)
		if err != nil {
			return nil, false, err
		}
		if !blocked {
			out = append(out, e)
		}
	}
	return out, held, nil
}

// candidates is gather that, when fromCache is set and the cache holds the
// group's answer for the Title, answers from the cache instead of searching again.
func (s *Service) candidates(ctx context.Context, sub subject, scope library.Scope, g group, fromCache bool) ([]*entry, []indexers.Failure, error) {
	if fromCache {
		es, held, err := s.cachedFor(ctx, sub.detail.ID, g)
		if err != nil || held {
			return es, nil, err
		}
	}
	return s.gather(ctx, sub, scope, g)
}

func newID() string {
	var b [12]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// subject is a Title and its Versions with their resolved Profiles.
type subject struct {
	detail   library.Detail
	versions map[Slot]*scoring.Profile
}

// subjectOf is the subject of a Movie or a Series.
func (s *Service) subjectOf(ctx context.Context, titleID int64) (subject, error) {
	region, _, err := s.prof.Region(ctx)
	if err != nil {
		return subject{}, err
	}
	d, err := s.lib.Get(ctx, titleID, library.View{Country: region.Country, Now: s.clock()})
	if err != nil {
		return subject{}, err
	}
	all, err := s.prof.List(ctx)
	if err != nil {
		return subject{}, err
	}
	byKey := map[string]profiles.Profile{}
	for _, p := range all {
		byKey[p.Key] = p
	}
	sub := subject{detail: d, versions: map[Slot]*scoring.Profile{}}
	for _, v := range d.Versions {
		p, ok := byKey[v.Profile]
		if !ok {
			return subject{}, fmt.Errorf("acquire: Version %d has unknown Profile %q", v.ID, v.Profile)
		}
		sp, err := s.snap.Current().Profile(p.Spec(region.Primary.Release()))
		if err != nil {
			return subject{}, err
		}
		sub.versions[v.Slot] = sp
	}
	return sub, nil
}

// gather searches the indexers of the group g for the Title and scores each
// Release under the Profile of every Version the Title has. The entries go
// into the candidate cache. Search on add, sweeps and retries reuse it.
//
// With reuse allowed (withReuse) a recent answer of the group for the same or a wider scope is returned instead of
// asking the indexers.
func (s *Service) gather(ctx context.Context, sub subject, scope library.Scope, g group) ([]*entry, []indexers.Failure, error) {
	if es, ok, err := s.reused(ctx, sub, scope, g); err != nil || ok {
		return es, nil, err
	}
	d := sub.detail
	if d.Kind == library.Series {
		return s.gatherSeries(ctx, sub, scope, g)
	}
	res := s.search(ctx, g, indexers.Query{
		Media: indexer.MediaMovie, IMDBID: d.IMDbID, TMDBID: d.TMDBID, Year: d.Year,
		Titles: searchTitles(d.Title, d.OriginalTitle, d.PrimaryTitle),
	})
	title := scoring.Title{Name: d.Title, Year: d.Year, OriginalLanguage: release.LanguageByISO(d.OriginalLanguage)}
	names := map[string]bool{}
	for _, n := range []string{d.Title, d.OriginalTitle, d.PrimaryTitle} {
		names[normalize(n)] = true
	}
	for _, a := range d.Aliases {
		names[normalize(a.Title)] = true
	}

	now := s.clock()
	var out []*entry
	for _, r := range res.Releases {
		parsed, err := release.Parse(r.Title, release.KindMovie)
		if err != nil {
			continue // not a name that can be read
		}
		if !r.ByID && !titleMatches(parsed, d.Year, names) {
			continue // a text hit for some other Title
		}
		e, err := s.entryFor(ctx, sub, r, parsed, title, now)
		if err != nil {
			return nil, nil, err
		}
		out = append(out, e)
	}
	if err := s.releaseSeen(ctx, d, len(out)); err != nil {
		return nil, nil, err
	}
	s.markFit(ctx, sub, res, out)
	s.cache.put(now, d.ID, g, out)
	if len(res.Failures) == 0 {
		s.cache.answered(now, d.ID, g, askedOf(library.Scope{}))
	}
	return out, res.Failures, nil
}

// markFit tells the indexers host which of the lanes of a Search returned a Release that fits one of the
// subject's Slots, for the Overview's Hit column.
func (s *Service) markFit(ctx context.Context, sub subject, res indexers.Result, out []*entry) {
	if len(res.Searches) == 0 {
		return
	}
	fitting := map[int64]bool{}
	for _, e := range out {
		for slot := range sub.versions {
			if e.fits(slot) == FitsThisSlot {
				fitting[e.raw.IndexerID] = true
			}
		}
	}
	s.idx.MarkFit(ctx, res.Searches, fitting)
}

// entryFor scores a parsed Release under the Profile of every Version of the subject.
func (s *Service) entryFor(ctx context.Context, sub subject, r indexers.Release, parsed release.ParsedRelease, title scoring.Title, now time.Time) (*entry, error) {
	blocked, err := s.blocklisted(ctx, r)
	if err != nil {
		return nil, err
	}
	sr := scoring.Release{Parsed: parsed, IndexerLanguages: languagesOf(r.Languages), IndexerFlags: flagsOf(r), Size: r.Size, Blocklisted: blocked}
	e := &entry{id: newID(), titleID: sub.detail.ID, at: now, raw: r}
	e.cand = Candidate{
		GUID: r.GUID, IndexerID: strconv.FormatInt(r.IndexerID, 10), Parsed: parsed, Verdicts: map[Slot]scoring.Verdict{},
		PublishDate: r.PublishDate, Size: r.Size, IndexerPriority: r.IndexerPriority,
	}
	_, e.cand.ClassKnown = resolution.OfHeight(parsed.Quality.Quality.Resolution)
	for slot, p := range sub.versions {
		e.cand.Verdicts[slot] = scoring.Evaluate(sr, title, p)
	}
	return e, nil
}

func titleMatches(p release.ParsedRelease, year int, names map[string]bool) bool {
	if p.Year > 0 && year > 0 && (p.Year < year-1 || p.Year > year+1) {
		return false
	}
	return slices.ContainsFunc(p.Titles, func(t string) bool { return names[normalize(t)] })
}

func languagesOf(names []string) []release.Language {
	var out []release.Language
	for _, n := range names {
		if l := release.LanguageByName(n); l != release.LangUnknown {
			out = append(out, l)
		}
	}
	return out
}

func flagsOf(r indexers.Release) scoring.Flags {
	var f scoring.Flags
	if r.Scene {
		f |= scoring.FlagScene
	}
	if r.Nuked {
		f |= scoring.FlagNuked
	}
	return f
}

// reasonsFor says why e cannot go to the Version in slot.
func reasonsFor(e *entry, slot Slot) []scoring.Rejection { return Rejections(slot, e.cand) }

// fits says which Version the Release belongs to, seen from the Version in slot.
func (e *entry) fits(slot Slot) Fit {
	switch {
	case Fits(slot, e.cand):
		return FitsThisSlot
	case e.cand.ClassKnown:
		return FitsOtherSlot
	}
	return FitsNone
}

// Search is a manual search for a Version: every enabled indexer is asked in
// parallel, whatever its Indexer Priority, each Release is parsed and evaluated against the Version's Profile
// and the lot is cached for CacheTTL. It returns library.ErrNotFound for an
// unknown Version.
func (s *Service) Search(ctx context.Context, versionID int64) (SearchResult, error) {
	return s.SearchScope(ctx, versionID, library.Scope{})
}

// SearchScope is Search narrowed, for a Series Version, to a season or to
// episodes of it. A Movie Version ignores the scope.
func (s *Service) SearchScope(ctx context.Context, versionID int64, scope library.Scope) (SearchResult, error) {
	return s.Releases(ctx, versionID, scope, true)
}

// Releases is SearchScope for Interactive search. Unless fresh, an answer of the indexers younger than ReuseWindow
// for the same or a wider scope is listed instead of asking again (SearchedAt says when it was given, Cached that it
// was); with none it searches as SearchScope does.
func (s *Service) Releases(ctx context.Context, versionID int64, scope library.Scope, fresh bool) (SearchResult, error) {
	defer s.snap.Hold()()
	titleID, err := s.lib.TitleOfVersion(ctx, versionID)
	if err != nil {
		return SearchResult{}, err
	}
	sub, err := s.subjectOf(ctx, titleID)
	if err != nil {
		return SearchResult{}, err
	}
	slot, ok := slotOf(sub.detail, versionID)
	if !ok {
		return SearchResult{}, library.ErrNotFound
	}
	ctx = indexers.WithManual(ctx)
	var rec *reuse
	if !fresh {
		ctx, rec = withReuse(ctx)
		rec.listing = true
	}
	entries, failures, err := s.gather(ctx, sub, scope, everyIndexer)
	if err != nil {
		return SearchResult{}, err
	}
	eps, err := s.seriesEpisodes(ctx, sub.detail)
	if err != nil {
		return SearchResult{}, err
	}
	out := SearchResult{Failures: failures, SearchedAt: s.clock(), Indexers: s.idx.Enabled(ctx), Wanted: wantedIn(sub.detail, eps, slot, scope)}
	if rec != nil && rec.hits > 0 {
		out.Cached, out.SearchedAt = true, rec.oldest
	}
	for _, e := range entries {
		v := e.cand.Verdicts[slot]
		f := Found{
			ID: e.id, GUID: e.raw.GUID, Name: e.raw.Title, Indexer: e.raw.IndexerName, IndexerID: e.raw.IndexerID, Size: e.raw.Size,
			PublishedAt: e.raw.PublishDate, Quality: e.cand.Parsed.Quality.Quality.Name, Formats: v.Matched, Score: v.Score, Fits: e.fits(slot),
		}
		pa := e.cand.Parsed
		f.VideoCodec, f.HDR, f.AudioCodec, f.AudioChannels = pa.VideoCodec, pa.HDR, pa.AudioCodec, pa.AudioChannels
		f.Group, f.InfoURL, f.Grabs = cmp.Or(e.raw.Group, e.cand.Parsed.ReleaseGroup), e.raw.InfoURL, e.raw.Grabs
		if sr := e.cand.Parsed.Series; sr != nil {
			f.Season, f.Episodes, f.Pack = sr.Season, slices.Clone(sr.Episodes), sr.FullSeason
		}
		f.Covers = coversOf(sub.detail, e.cand.Parsed, eps, slot)
		if p := sub.versions[slot]; p != nil {
			f.PerEpisode = e.cand.Parsed.Kind != release.KindMovie
			f.SizeLimit = p.SizeLimit(e.cand.Parsed.Kind)
		}
		for _, l := range v.Languages {
			f.Languages = append(f.Languages, l.Name)
		}
		for _, code := range slices.Concat(reasonsFor(e, slot), unlistedReasons(sub.detail, eps, e.cand.Parsed, s.clock())) {
			f.Rejections = append(f.Rejections, Reason{Code: code, Overridable: Overridable(code)})
		}
		out.Items = append(out.Items, f)
	}
	slices.SortStableFunc(out.Items, func(a, b Found) int {
		switch {
		case (len(a.Rejections) == 0) != (len(b.Rejections) == 0):
			if len(a.Rejections) == 0 {
				return -1
			}
			return 1
		case a.Score != b.Score:
			return b.Score - a.Score
		}
		return b.PublishedAt.Compare(a.PublishedAt)
	})
	return out, nil
}

func slotOf(d library.Detail, versionID int64) (Slot, bool) {
	for _, v := range d.Versions {
		if v.ID == versionID {
			return v.Slot, true
		}
	}
	return "", false
}

// Grab is a Release sent to the download client.
type Grab struct {
	ID        int64
	TitleID   int64
	VersionID int64
	// VersionIDs are every Version the download fills, VersionID first. One Release that is the pick for several
	// Versions of a Title is downloaded once; Import then links it under each Version's own name.
	VersionIDs  []int64
	ReleaseName string
	IndexerName string
	// IndexerID is the indexer instance the Release came from.
	IndexerID   int64
	Size        int64
	PublishedAt time.Time
	Score       int
	// ClientID is the download client's id for the job (SABnzbd's nzo_id).
	ClientID string
	// ClientInstanceID is the download client instance that holds the job.
	ClientInstanceID int64
	// State is sent, downloading, completed, importing, imported or failed.
	State string
	// Failure says why a failed Grab failed: failed, encrypted or other.
	Failure string
	// Overridden is true when it was grabbed despite rejections.
	Overridden bool
	// IsUpgrade is true when the Version already held a file.
	IsUpgrade bool
	CreatedAt time.Time
	// UpdatedAt is when the state last changed; for a finished Grab, when it finished.
	UpdatedAt time.Time
	// DownloadStartedAt and DownloadDoneAt are when the download client first reported the Grab downloading and
	// finished; nil until it did.
	DownloadStartedAt, DownloadDoneAt *time.Time
	// Why is how the Grab was chosen: the Wanted it covers, the files it replaces and the Score gain. Nil on a Grab
	// from before it was recorded.
	Why *Why
	// ImportChecking is how many downloaded files the running Import is checking; nil when it has not said.
	ImportChecking *int
	// ImportReplaced is how many library files the finished Import replaced; nil before it finished (or on a Grab
	// from before it was recorded).
	ImportReplaced *int
}

func grabOf(r db.Grab) Grab {
	g := Grab{
		ID: r.ID, TitleID: r.TitleID.Int64, VersionID: r.VersionID.Int64, ReleaseName: r.ReleaseName, IndexerName: r.IndexerName, IndexerID: r.IndexerID,
		Size: r.Size, PublishedAt: parseTime(r.PublishedAt), Score: int(r.Score), ClientID: r.ClientID, ClientInstanceID: r.ClientInstanceID, State: r.State, Failure: r.Failure.String,
		Overridden: r.Overridden == 1, IsUpgrade: r.IsUpgrade == 1, CreatedAt: parseTime(r.CreatedAt), UpdatedAt: parseTime(r.UpdatedAt),
	}
	if g.VersionID != 0 {
		g.VersionIDs = []int64{g.VersionID}
	}
	g.DownloadStartedAt, g.DownloadDoneAt = optTime(r.DownloadStartedAt), optTime(r.DownloadDoneAt)
	if r.CoversWanted.Valid && r.ReplacesFiles.Valid {
		g.Why = &Why{CoversWanted: int(r.CoversWanted.Int64), ReplacesFiles: int(r.ReplacesFiles.Int64), ScoreDelta: int(r.ScoreDelta.Int64)}
	}
	g.ImportChecking, g.ImportReplaced = optInt(r.ImportChecking), optInt(r.ImportReplaced)
	return g
}

// GetGrab returns a Grab, or sql.ErrNoRows wrapped in library.ErrNotFound's
// place: ErrGrabNotFound.
func (s *Service) GetGrab(ctx context.Context, id int64) (Grab, error) {
	row, err := db.New(s.st.Read()).GetGrab(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return Grab{}, ErrGrabNotFound
	}
	if err != nil {
		return Grab{}, err
	}
	g := grabOf(row)
	if err := s.bind(ctx, &g); err != nil {
		return Grab{}, err
	}
	return g, nil
}

// bind adds the Versions each Grab also fills to its VersionIDs.
func (s *Service) bind(ctx context.Context, grabs ...*Grab) error {
	rows, err := db.New(s.st.Read()).ListGrabVersions(ctx)
	if err != nil || len(rows) == 0 {
		return err
	}
	for _, g := range grabs {
		for _, r := range rows {
			if r.GrabID == g.ID && !slices.Contains(g.VersionIDs, r.VersionID) {
				g.VersionIDs = append(g.VersionIDs, r.VersionID)
			}
		}
	}
	return nil
}

// ErrGrabNotFound is returned for a Grab that does not exist.
var ErrGrabNotFound = errors.New("grab not found")

// Grab sends a Release from the candidate cache to the download client for a
// Version: the NZB is fetched from its indexer and added to the client, and a
// Grab row starts at `sent`, keyed by the client's id. Rejections refuse it
// unless override is set; blocklisted, other_slot and season_not_listed are
// refused whatever the override (a *RejectedError). The Blocklist is checked
// again here. A Series Release naming episodes TheTVDB does not list adds
// their Placeholder Episodes, so the Grab covers them.
func (s *Service) Grab(ctx context.Context, versionID int64, releaseID string, override bool) (Grab, error) {
	defer s.snap.Hold()()
	return s.grabBy(ctx, versionID, releaseID, override, GrabbedByHand)
}

// grabShared is the search pass's Grab (it already holds the snapshot gate) for a Release that is the pick for several Versions of a Movie: one download, bound to each.
func (s *Service) grabShared(ctx context.Context, versionIDs []int64, releaseID string) (Grab, error) {
	return s.grabBy(ctx, versionIDs[0], releaseID, false, GrabbedBySearch, versionIDs[1:]...)
}

// also are further Versions of the Title the Grab fills: those the Release fits without a rejection (a Movie only).
func (s *Service) grabBy(ctx context.Context, versionID int64, releaseID string, override bool, by string, also ...int64) (Grab, error) {
	titleID, err := s.lib.TitleOfVersion(ctx, versionID)
	if err != nil {
		return Grab{}, err
	}
	e, ok := s.cache.get(s.clock(), releaseID)
	if !ok || e.titleID != titleID {
		return Grab{}, ErrReleaseExpired
	}
	sub, err := s.subjectOf(ctx, titleID)
	if err != nil {
		return Grab{}, err
	}
	slot, ok := slotOf(sub.detail, versionID)
	if !ok {
		return Grab{}, library.ErrNotFound
	}

	eps, err := s.seriesEpisodes(ctx, sub.detail)
	if err != nil {
		return Grab{}, err
	}
	reasons := slices.Concat(reasonsFor(e, slot), unlistedReasons(sub.detail, eps, e.cand.Parsed, s.clock()))
	blocked, err := s.blocklisted(ctx, e.raw)
	if err != nil {
		return Grab{}, err
	}
	if blocked && !slices.Contains(reasons, scoring.RejectBlocklisted) {
		reasons = append(reasons, scoring.RejectBlocklisted)
	}
	if rej := (&RejectedError{Rejections: reasons}); len(reasons) > 0 && (rej.NotOverridable() || !override) {
		return Grab{}, rej
	}

	o := outgoing{titleID: titleID, versionID: versionID, e: e, slot: slot, media: downloads.Movie, overridden: len(reasons) > 0, by: by}
	if sub.detail.Kind == library.Series {
		eps, err := s.placeholdersNamed(ctx, titleID, e.raw.Title, e.cand.Parsed, eps)
		if err != nil {
			return Grab{}, err
		}
		o.media = downloads.Series
		o.episodes, o.upgrade = coveredBy(e.cand.Parsed, eps, slot)
	} else {
		for _, v := range sub.detail.Versions {
			if v.ID == versionID {
				o.upgrade = v.File != nil
			}
			if slices.Contains(also, v.ID) && len(reasonsFor(e, v.Slot)) == 0 && !blocked {
				o.also = append(o.also, v.ID)
			}
		}
	}
	return s.send(ctx, o)
}

// outgoing is a Release chosen for a Version, ready to send.
type outgoing struct {
	titleID, versionID int64
	// also are the other Versions the same download fills.
	also []int64
	e    *entry
	// copies are the other entries the same read produced for the Title: the
	// fallbacks when e's NZB cannot be fetched. send also looks in the candidate cache.
	copies []*entry
	slot   Slot
	media  downloads.Media
	// episodes are the episodes a Series Grab covers.
	episodes   []int64
	upgrade    bool
	overridden bool
	// by is who chose the Release: grabBy* below. It rides on the Grab's event, not on the Grab.
	by string
}

// Who grabbed a Release, as the Grab's `grab` event records it.
const (
	GrabbedByHand   = "by_hand"
	GrabbedBySearch = "by_search"
	GrabbedByRSS    = "by_rss"
)

// send fetches the NZB, adds it to the download client and records the Grab.
//
// The Version's Grab lock is held from the check of what its active Grabs already cover to the commit of the new
// Grab, so two sends for one Version cannot both pass the check. A plan whose Release is already active for the
// Version, or (unless a person chose it or it is an Upgrade) that covers nothing Wanted, is not sent: it returns
// errNotSent, which the callers treat as nothing to do.
func (s *Service) send(ctx context.Context, o outgoing) (Grab, error) {
	unlock, err := s.granting.lock(ctx, append([]int64{o.versionID}, o.also...))
	if err != nil {
		return Grab{}, err
	}
	defer unlock()
	// The Why is worked out before the NZB is added to the client, for the check below; it only reads the library.
	why, hasWhy := s.whyOf(ctx, o, o.e.cand.Verdicts[o.slot].Score)
	if err := s.stillNeeded(ctx, o, why, hasWhy); err != nil {
		return Grab{}, err
	}
	e, nzb, err := s.fetchNZB(ctx, o)
	if err != nil {
		return Grab{}, err
	}
	sent, err := s.dl.Add(ctx, downloads.Job{Media: o.media, Name: e.raw.Title, NZB: nzb})
	if err != nil {
		return Grab{}, err
	}

	// The Grab names the Indexer that delivered; the verdict is the chosen Release's.
	verdict := o.e.cand.Verdicts[o.slot]
	parsed, _ := json.Marshal(e.cand.Parsed)
	vjson, _ := json.Marshal(verdict)
	now := ts(s.clock())
	tx, err := s.st.Write().BeginTx(ctx, nil)
	if err != nil {
		return Grab{}, err
	}
	defer tx.Rollback()
	q := db.New(tx)
	row, err := q.InsertGrab(ctx, db.InsertGrabParams{
		TitleID: nullID(o.titleID), VersionID: nullID(o.versionID), ReleaseGuid: e.raw.GUID, ReleaseName: e.raw.Title,
		IndexerID: e.raw.IndexerID, IndexerName: e.raw.IndexerName, Size: e.raw.Size, PublishedAt: ts(e.raw.PublishDate),
		Score: int64(verdict.Score), Parsed: string(parsed), Verdict: string(vjson), Overridden: b2i(o.overridden), IsUpgrade: b2i(o.upgrade),
		ClientInstanceID: sent.InstanceID, ClientID: sent.ClientID, CreatedAt: now, UpdatedAt: now,
	})
	if err != nil {
		return Grab{}, err
	}
	for _, v := range o.also {
		if err := q.InsertGrabVersion(ctx, db.InsertGrabVersionParams{GrabID: row.ID, VersionID: v}); err != nil {
			return Grab{}, err
		}
	}
	for _, ep := range o.episodes {
		if err := q.InsertGrabEpisode(ctx, db.InsertGrabEpisodeParams{GrabID: row.ID, EpisodeID: ep}); err != nil {
			return Grab{}, err
		}
	}
	if hasWhy {
		if err := q.SetGrabWhy(ctx, db.SetGrabWhyParams{
			CoversWanted: sql.NullInt64{Int64: int64(why.CoversWanted), Valid: true}, ReplacesFiles: sql.NullInt64{Int64: int64(why.ReplacesFiles), Valid: true},
			ScoreDelta: sql.NullInt64{Int64: int64(why.ScoreDelta), Valid: true}, ID: row.ID,
		}); err != nil {
			return Grab{}, err
		}
		row.CoversWanted, row.ReplacesFiles, row.ScoreDelta = sql.NullInt64{Int64: int64(why.CoversWanted), Valid: true}, sql.NullInt64{Int64: int64(why.ReplacesFiles), Valid: true}, sql.NullInt64{Int64: int64(why.ScoreDelta), Valid: true}
	}
	if err := tx.Commit(); err != nil {
		return Grab{}, err
	}
	g := grabOf(row)
	g.VersionIDs = append(g.VersionIDs, o.also...)
	s.hist.Record(ctx, history.Event{
		Kind: history.GrabSent, TitleID: o.titleID, VersionID: o.versionID, GrabID: g.ID, Message: "Sent " + g.ReleaseName + " to the download client",
		Reason: grabReason(ctx, o.by, o.e, s.clock()),
		Data:   grabSentData(o.by),
	})
	return g, nil
}

// errNotSent is a Grab that send dropped because an active Grab already has the Release or covers what it was for.
var errNotSent = errors.New("grab not sent: already covered by an active grab")

// ErrAlreadyGrabbed is returned for a Release an active Grab of the Version already fetches.
var ErrAlreadyGrabbed = errors.New("release already grabbed for this version")

// stillNeeded checks, under the Version's Grab lock, that o is not made redundant by a Grab recorded since its plan
// was made. It reports errNotSent for a plan to drop, ErrAlreadyGrabbed for a person's pick of a Release that is
// already active.
func (s *Service) stillNeeded(ctx context.Context, o outgoing, why Why, hasWhy bool) error {
	q := db.New(s.st.Read())
	active, err := q.ListActiveGrabs(ctx)
	if err != nil {
		return err
	}
	// A Grab whose Import is stalled still has its download.
	stalled, err := q.ListStalledGrabs(ctx)
	if err != nil {
		return err
	}
	bound, err := q.ListGrabVersions(ctx)
	if err != nil {
		return err
	}
	for _, g := range append(active, stalled...) {
		fills := g.VersionID.Int64 == o.versionID || slices.ContainsFunc(bound, func(b db.GrabVersion) bool { return b.GrabID == g.ID && b.VersionID == o.versionID })
		if g.ReleaseGuid == o.e.raw.GUID && g.IndexerID == o.e.raw.IndexerID && fills {
			if o.by == GrabbedByHand {
				return ErrAlreadyGrabbed
			}
			return errNotSent
		}
	}
	if o.by == GrabbedByHand || o.upgrade {
		return nil
	}
	if hasWhy && why.CoversWanted == 0 && !why.early {
		return errNotSent
	}
	if o.media == downloads.Series && len(o.episodes) > 0 {
		covered, err := s.coveredEpisodes(ctx)
		if err != nil {
			return err
		}
		if !slices.ContainsFunc(o.episodes, func(ep int64) bool { return !covered[[2]int64{o.versionID, ep}] }) {
			return errNotSent
		}
	}
	return nil
}

// fetchNZB fetches the NZB of the chosen Release, else of the same Release from
// the other Indexers that offered it, by Indexer Priority, and returns the entry
// that delivered it. When none does it returns the chosen copy's error.
func (s *Service) fetchNZB(ctx context.Context, o outgoing) (*entry, []byte, error) {
	var first error
	for i, e := range append([]*entry{o.e}, s.otherCopies(ctx, o)...) {
		nzb, err := s.idx.Fetch(ctx, e.raw.IndexerID, e.raw.DownloadURL)
		if err == nil {
			return e, nzb, nil
		}
		if i == 0 {
			first = err
		}
	}
	if errors.Is(first, indexers.ErrNoSuchIndexer) || errors.Is(first, &plugin.Error{Code: plugin.CodeNotFound}) {
		return nil, nil, ErrReleaseGone
	}
	return nil, nil, first
}

// otherCopies are the same Release (by the Blocklist's rule) from other Indexers
// in the read that produced o and in the candidate cache, off the Blocklist, in
// Indexer Priority order (lower first, then by Indexer id).
func (s *Service) otherCopies(ctx context.Context, o outgoing) []*entry {
	chosen := o.e.raw
	pool := slices.Clone(o.copies)
	s.cache.mu.Lock()
	for _, e := range s.cache.m {
		if e.titleID == o.titleID && s.clock().Sub(e.at) < CacheTTL {
			pool = append(pool, e)
		}
	}
	s.cache.mu.Unlock()
	var out []*entry
	for _, e := range pool {
		r := e.raw
		if r.IndexerID == chosen.IndexerID || !sameRelease(chosen.Title, chosen.PublishDate, chosen.Size, r.Title, r.PublishDate, r.Size) {
			continue
		}
		if slices.ContainsFunc(out, func(x *entry) bool { return x.raw.IndexerID == r.IndexerID && x.raw.GUID == r.GUID }) {
			continue
		}
		if blocked, err := s.blocklisted(ctx, r); err != nil || blocked {
			continue
		}
		out = append(out, e)
	}
	slices.SortFunc(out, func(a, b *entry) int {
		return cmp.Or(cmp.Compare(a.raw.IndexerPriority, b.raw.IndexerPriority), cmp.Compare(a.raw.IndexerID, b.raw.IndexerID))
	})
	return out
}

// GrabEpisodes are the episodes a Series Grab was sent for, by id; none for a Movie.
func (s *Service) GrabEpisodes(ctx context.Context, grabID int64) ([]int64, error) {
	return db.New(s.st.Read()).ListGrabEpisodes(ctx, grabID)
}

// FetchingEpisodes are the ids of a Series' episodes its active Grabs are
// fetching (a stalled Import still holds its episodes).
func (s *Service) FetchingEpisodes(ctx context.Context, titleID int64) (map[int64]bool, error) {
	ids, err := db.New(s.st.Read()).ListActiveGrabEpisodesOfTitle(ctx, sql.NullInt64{Int64: titleID, Valid: true})
	if err != nil {
		return nil, err
	}
	out := make(map[int64]bool, len(ids))
	for _, id := range ids {
		out[id] = true
	}
	return out, nil
}

// decide is Decide over candidates whose indexers' Grabs may be paused right
// now. The flag is set here and not when a Release is cached, so a pause that
// began or ended since the search counts. With Pause Grabs on it plans
// nothing: every automatic Grab goes through here, a hand-started one does not.
func (s *Service) decide(ctx context.Context, in Input) ([]GrabPlan, error) {
	if paused, err := s.grabsPaused(ctx); err != nil || paused {
		return nil, err
	}
	return s.plan(in), nil
}

// grabsPaused says whether Pause Grabs is on.
func (s *Service) grabsPaused(ctx context.Context) (bool, error) {
	if s.pause == nil {
		return false, nil
	}
	return s.pause.Paused(ctx)
}

// plan is decide whatever Pause Grabs says: what would be grabbed. A search
// that asks the indexers by priority uses it to know what one group left for
// the next, and checks Pause Grabs once before it grabs.
func (s *Service) plan(in Input) []GrabPlan {
	cands := slices.Clone(in.Candidates)
	for i := range cands {
		if id, err := strconv.ParseInt(cands[i].IndexerID, 10, 64); err == nil {
			cands[i].IndexerGrabsPaused = s.idx.GrabsPaused(id)
		}
	}
	in.Candidates = cands
	return Decide(in)
}

// grabReason is why a Grab was made: the search's reason when a search chose the Release ("retry: import of X
// rejected: language", "new: the first search of a Version just added"), else who else chose it.
func grabReason(ctx context.Context, by string, e *entry, now time.Time) string {
	why := "chosen by a search"
	switch by {
	case GrabbedByHand:
		why = "chosen by hand"
	case GrabbedByRSS:
		return "RSS: a new Release matched what the Version is missing"
	default:
		if r := reasonOf(ctx); r != "" {
			why += " (" + r + ")"
		}
	}
	if e != nil && e.rss {
		why += "; found in RSS " + ago(now.Sub(e.at))
	}
	return why
}

// grabCanceledData is the `grab_canceled` event's payload: the Grab as it was before its row went, and whether its
// Release was blocklisted.
func grabCanceledData(g Grab, blocklisted bool) json.RawMessage {
	b, _ := json.Marshal(map[string]any{
		"grab_id": g.ID, "release": g.ReleaseName, "title_id": g.TitleID, "version_id": g.VersionID, "version_ids": g.VersionIDs,
		"blocklisted": blocklisted,
	})
	return b
}

// grabSentData is the `grab` event's payload: who chose the Release. Grabs from before it was recorded have none.
func grabSentData(by string) json.RawMessage {
	if by == "" {
		return nil
	}
	b, _ := json.Marshal(map[string]string{"by": by})
	return b
}
