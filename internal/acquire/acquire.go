package acquire

import (
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
// (blocklisted, other_slot): no "Grab anyway" for this Release.
func (e *RejectedError) NotOverridable() bool {
	return slices.ContainsFunc(e.Rejections, func(r scoring.Rejection) bool { return !Overridable(r) })
}

// Overridable says whether "Grab anyway" may override the rejection. Every
// code can be except blocklisted and other_slot.
func Overridable(r scoring.Rejection) bool {
	return r != scoring.RejectBlocklisted && r != RejectOtherSlot
}

// Library is what acquire reads from the library module.
type Library interface {
	TitleOfVersion(ctx context.Context, versionID int64) (int64, error)
	Get(ctx context.Context, id int64, view library.View) (library.Detail, error)
	// Names and Episodes serve RSS: the Titles to match a feed to and a Series' episodes.
	Names(ctx context.Context) ([]library.Named, error)
	Episodes(ctx context.Context, titleID int64, view library.View) ([]library.Episode, error)
}

// Profiles is what acquire reads from the scoring module's settings.
type Profiles interface {
	List(ctx context.Context) ([]profiles.Profile, error)
	Region(ctx context.Context) (profiles.Region, bool, error)
}

// Indexers is the indexers host.
type Indexers interface {
	Search(ctx context.Context, q indexers.Query) indexers.Result
	RSS(ctx context.Context) indexers.Result
	Fetch(ctx context.Context, indexerID int64, downloadURL string) ([]byte, error)
	// GrabsPaused says whether the indexer's Grabs are paused: Decide skips its Releases.
	GrabsPaused(indexerID int64) bool
	// CanSweep says whether a sweep could ask any indexer now (the 80 % stop, pauses).
	CanSweep(ctx context.Context) bool
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
	// searches runs the searches started by hand, two at a time.
	searches *background
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
		snap: d.Scoring, cache: &cache{m: map[string]*entry{}}, live: &liveSet{m: map[int64]Live{}}, hist: d.History, misses: &missCount{m: map[int64]int{}},
		pause: d.Pause, searches: newBackground(2),
	}
	d.Scoring.OnSwap(func() {
		svc.cache.mu.Lock()
		svc.cache.m = map[string]*entry{}
		svc.cache.mu.Unlock()
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
}

// SearchResult is the outcome of a manual search.
type SearchResult struct {
	// Items are every Release the indexers offered, best first: acceptable
	// ones before rejected, then by Score, then newest.
	Items []Found
	// Failures are the indexers that could not answer fully.
	Failures []indexers.Failure
}

// entry is a Release in the candidate cache: the indexer's answer and its
// Verdict under every Version of the Title.
type entry struct {
	id      string
	titleID int64
	at      time.Time
	raw     indexers.Release
	cand    Candidate
}

type cache struct {
	mu sync.Mutex
	m  map[string]*entry
}

func (c *cache) put(now time.Time, es []*entry) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for id, e := range c.m {
		if now.Sub(e.at) >= CacheTTL {
			delete(c.m, id)
		}
	}
	for _, e := range es {
		c.m[e.id] = e
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

// cachedFor returns the Title's Releases in the cache that are still fresh and
// not on the Blocklist now, and whether the cache holds any for it at all.
func (s *Service) cachedFor(ctx context.Context, titleID int64) ([]*entry, bool, error) {
	now := s.clock()
	c := s.cache
	c.mu.Lock()
	var all []*entry
	for _, e := range c.m {
		if e.titleID == titleID && now.Sub(e.at) < CacheTTL {
			all = append(all, e)
		}
	}
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
	return out, len(all) > 0, nil
}

// candidates is gather that, when fromCache is set and the Title has fresh
// Releases cached, answers from the cache instead of searching again.
func (s *Service) candidates(ctx context.Context, sub subject, scope Scope, fromCache bool) ([]*entry, []indexers.Failure, error) {
	if fromCache {
		es, held, err := s.cachedFor(ctx, sub.detail.ID)
		if err != nil || held {
			return es, nil, err
		}
	}
	return s.gather(ctx, sub, scope)
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

// gather searches every indexer for the Title and scores each Release under
// the Profile of every Version the Title has. The entries go into the
// candidate cache. Search on add, sweeps and retries reuse it.
func (s *Service) gather(ctx context.Context, sub subject, scope Scope) ([]*entry, []indexers.Failure, error) {
	d := sub.detail
	if d.Kind == library.Series {
		return s.gatherSeries(ctx, sub, scope)
	}
	res := s.idx.Search(ctx, indexers.Query{
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
	s.cache.put(now, out)
	return out, res.Failures, nil
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
// parallel, each Release is parsed and evaluated against the Version's Profile
// and the lot is cached for CacheTTL. It returns library.ErrNotFound for an
// unknown Version.
func (s *Service) Search(ctx context.Context, versionID int64) (SearchResult, error) {
	return s.SearchScope(ctx, versionID, Scope{})
}

// SearchScope is Search narrowed, for a Series Version, to a season or to
// episodes of it. A Movie Version ignores the scope.
func (s *Service) SearchScope(ctx context.Context, versionID int64, scope Scope) (SearchResult, error) {
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
	entries, failures, err := s.gather(ctx, sub, scope)
	if err != nil {
		return SearchResult{}, err
	}
	out := SearchResult{Failures: failures}
	for _, e := range entries {
		v := e.cand.Verdicts[slot]
		f := Found{
			ID: e.id, GUID: e.raw.GUID, Name: e.raw.Title, Indexer: e.raw.IndexerName, IndexerID: e.raw.IndexerID, Size: e.raw.Size,
			PublishedAt: e.raw.PublishDate, Quality: e.cand.Parsed.Quality.Quality.Name, Formats: v.Matched, Score: v.Score, Fits: e.fits(slot),
		}
		if sr := e.cand.Parsed.Series; sr != nil {
			f.Season, f.Episodes, f.Pack = sr.Season, slices.Clone(sr.Episodes), sr.FullSeason
		}
		for _, l := range v.Languages {
			f.Languages = append(f.Languages, l.Name)
		}
		for _, code := range reasonsFor(e, slot) {
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
	return 0, false
}

// Grab is a Release sent to the download client.
type Grab struct {
	ID          int64
	TitleID     int64
	VersionID   int64
	ReleaseName string
	IndexerName string
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
}

func grabOf(r db.Grab) Grab {
	return Grab{
		ID: r.ID, TitleID: r.TitleID.Int64, VersionID: r.VersionID.Int64, ReleaseName: r.ReleaseName, IndexerName: r.IndexerName,
		Size: r.Size, PublishedAt: parseTime(r.PublishedAt), Score: int(r.Score), ClientID: r.ClientID, ClientInstanceID: r.ClientInstanceID, State: r.State, Failure: r.Failure.String,
		Overridden: r.Overridden == 1, IsUpgrade: r.IsUpgrade == 1, CreatedAt: parseTime(r.CreatedAt),
	}
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
	return grabOf(row), nil
}

// ErrGrabNotFound is returned for a Grab that does not exist.
var ErrGrabNotFound = errors.New("grab not found")

// Grab sends a Release from the candidate cache to the download client for a
// Version: the NZB is fetched from its indexer and added to the client, and a
// Grab row starts at `sent`, keyed by the client's id. Rejections refuse it
// unless override is set; blocklisted and other_slot are refused whatever the
// override (a *RejectedError). The Blocklist is checked again here.
func (s *Service) Grab(ctx context.Context, versionID int64, releaseID string, override bool) (Grab, error) {
	defer s.snap.Hold()()
	return s.grab(ctx, versionID, releaseID, override)
}

// grab is Grab for callers that already hold the snapshot gate.
func (s *Service) grab(ctx context.Context, versionID int64, releaseID string, override bool) (Grab, error) {
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

	reasons := slices.Clone(reasonsFor(e, slot))
	if blocked, err := s.blocklisted(ctx, e.raw); err != nil {
		return Grab{}, err
	} else if blocked && !slices.Contains(reasons, scoring.RejectBlocklisted) {
		reasons = append(reasons, scoring.RejectBlocklisted)
	}
	if rej := (&RejectedError{Rejections: reasons}); len(reasons) > 0 && (rej.NotOverridable() || !override) {
		return Grab{}, rej
	}

	o := outgoing{titleID: titleID, versionID: versionID, e: e, slot: slot, media: downloads.Movie, overridden: len(reasons) > 0}
	if sub.detail.Kind == library.Series {
		eps, err := s.lib.Episodes(ctx, titleID, library.View{Now: s.clock()})
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
		}
	}
	return s.send(ctx, o)
}

// outgoing is a Release chosen for a Version, ready to send.
type outgoing struct {
	titleID, versionID int64
	e                  *entry
	slot               Slot
	media              downloads.Media
	// episodes are the episodes a Series Grab covers.
	episodes   []int64
	upgrade    bool
	overridden bool
}

// send fetches the NZB, adds it to the download client and records the Grab.
func (s *Service) send(ctx context.Context, o outgoing) (Grab, error) {
	e := o.e
	nzb, err := s.idx.Fetch(ctx, e.raw.IndexerID, e.raw.DownloadURL)
	if err != nil {
		if errors.Is(err, indexers.ErrNoSuchIndexer) || errors.Is(err, &plugin.Error{Code: plugin.CodeNotFound}) {
			return Grab{}, ErrReleaseGone
		}
		return Grab{}, err
	}
	sent, err := s.dl.Add(ctx, downloads.Job{Media: o.media, Name: e.raw.Title, NZB: nzb})
	if err != nil {
		return Grab{}, err
	}

	verdict := e.cand.Verdicts[o.slot]
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
	for _, ep := range o.episodes {
		if err := q.InsertGrabEpisode(ctx, db.InsertGrabEpisodeParams{GrabID: row.ID, EpisodeID: ep}); err != nil {
			return Grab{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Grab{}, err
	}
	g := grabOf(row)
	s.hist.Record(ctx, history.Event{
		Kind: history.GrabSent, TitleID: o.titleID, VersionID: o.versionID, GrabID: g.ID, Message: "Sent " + g.ReleaseName + " to the download client",
	})
	return g, nil
}

// GrabEpisodes are the episodes a Series Grab was sent for, by id; none for a Movie.
func (s *Service) GrabEpisodes(ctx context.Context, grabID int64) ([]int64, error) {
	return db.New(s.st.Read()).ListGrabEpisodes(ctx, grabID)
}

// decide is Decide over candidates whose indexers' Grabs may be paused right
// now. The flag is set here and not when a Release is cached, so a pause that
// began or ended since the search counts. With Pause Grabs on it plans
// nothing: every automatic Grab goes through here, a hand-started one does not.
func (s *Service) decide(ctx context.Context, in Input) ([]GrabPlan, error) {
	if s.pause != nil {
		if paused, err := s.pause.Paused(ctx); err != nil || paused {
			return nil, err
		}
	}
	cands := slices.Clone(in.Candidates)
	for i := range cands {
		if id, err := strconv.ParseInt(cands[i].IndexerID, 10, 64); err == nil {
			cands[i].IndexerGrabsPaused = s.idx.GrabsPaused(id)
		}
	}
	in.Candidates = cands
	return Decide(in), nil
}
