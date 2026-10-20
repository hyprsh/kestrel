package acquire

import (
	"cmp"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"slices"
	"strconv"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire/db"
	"github.com/hyprsh/kestrel/internal/downloads"
	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/indexers"
	"github.com/hyprsh/kestrel/internal/library"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
)

// ErrNoOffer means the Version has no Original Offer to accept or dismiss.
var ErrNoOffer = errors.New("the Version has no Original Offer")

// Offer is a Version's Original Offer (#103): the Releases with the Title's
// Original Language but no Primary-Language audio that its Profile held back
// for what the Version is missing. It lasts while those units are Wanted with
// no active Grab, so a Primary-Language Release that is grabbed ends it.
type Offer struct {
	TitleID   int64
	Title     string
	VersionID int64
	Slot      Slot
	Profile   string
	// Releases are best first: a Movie's one, or a Series' episode and pack Releases.
	Releases []OfferedRelease
	// FoundAt is when the newest of them was offered.
	FoundAt time.Time
	// Dismissed is true while every unit was dismissed: the admin waits for a
	// Primary-Language Release. Dismissal is per unit: a unit stays dismissed
	// until a higher-scoring Release is found for it, and while any unit is
	// not dismissed, Releases holds those units alone.
	Dismissed bool
}

// OfferedRelease is one Release of an Offer, with what it is offered for.
type OfferedRelease struct {
	Name        string
	Indexer     string
	Score       int
	Size        int64
	PublishedAt time.Time
	// Season is a Series Release's season; nil for a Movie.
	Season *int
	Pack   bool
	// Episodes are the episode numbers in Season it is offered for.
	Episodes []int

	row        db.OriginalOffer
	rowIDs     []int64 // one per unit
	episodeIDs []int64
	upgrade    bool
	series     bool
}

// noteOffers records the Original Offers a Decide host's input holds (see
// OriginalOffers): per Version and unit, the best Release kept so far, which
// a higher-scoring one replaces. Units that hold a fitting file lose theirs.
// Each Release newly offered records an original_offered event.
func (s *Service) noteOffers(ctx context.Context, d library.Detail, versionOf map[Slot]int64, in Input, entries map[string]*entry, episodes []library.Episode) error {
	unit := func(versionID int64, ref EpisodeRef) db.GetOriginalOfferParams {
		return db.GetOriginalOfferParams{VersionID: versionID, EpisodeID: sql.NullInt64{Int64: episodeID(episodes, ref), Valid: true}}
	}
	offers := OriginalOffers(in)
	tx, err := s.st.Write().BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	q := db.New(tx)
	for _, v := range in.Versions {
		for _, u := range v.Units {
			if u.Held == nil || !u.Held.Fits {
				continue
			}
			cur, err := q.GetOriginalOffer(ctx, unit(versionOf[v.Slot], u.Ref))
			if errors.Is(err, sql.ErrNoRows) {
				continue
			}
			if err != nil {
				return err
			}
			if err := q.DeleteOriginalOffer(ctx, cur.ID); err != nil {
				return err
			}
		}
	}
	type offered struct {
		versionID int64
		name      string
	}
	var news []offered
	now := ts(s.clock())
	for _, p := range offers {
		e := entries[entryKey(p.Candidate)]
		if e == nil {
			continue
		}
		vid := versionOf[p.Slot]
		verdict := e.cand.Verdicts[p.Slot]
		parsed, err := json.Marshal(e.cand.Parsed)
		if err != nil {
			return err
		}
		vjson, err := json.Marshal(verdict)
		if err != nil {
			return err
		}
		added := false
		for _, ref := range p.Covers {
			cur, err := q.GetOriginalOffer(ctx, unit(vid, ref))
			switch {
			case err == nil && (cur.IndexerID == e.raw.IndexerID && cur.ReleaseGuid == e.raw.GUID || cur.Score >= int64(verdict.Score)):
				continue // the same Release, or as good a one, is already offered
			case err == nil:
				if err := q.DeleteOriginalOffer(ctx, cur.ID); err != nil {
					return err
				}
			case !errors.Is(err, sql.ErrNoRows):
				return err
			}
			episode := sql.NullInt64{}
			if d.Kind == library.Series {
				episode = sql.NullInt64{Int64: episodeID(episodes, ref), Valid: true}
			}
			if err := q.InsertOriginalOffer(ctx, db.InsertOriginalOfferParams{
				VersionID: vid, EpisodeID: episode, ReleaseGuid: e.raw.GUID, ReleaseName: e.raw.Title, IndexerID: e.raw.IndexerID,
				IndexerName: e.raw.IndexerName, DownloadUrl: e.raw.DownloadURL, Size: e.raw.Size, PublishedAt: ts(e.raw.PublishDate),
				Score: int64(verdict.Score), Parsed: string(parsed), Verdict: string(vjson), Pack: b2i(p.Pack), FoundAt: now,
			}); err != nil {
				return err
			}
			added = true
		}
		if added {
			news = append(news, offered{vid, e.raw.Title})
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	for _, n := range news {
		s.hist.Record(ctx, history.Event{
			Kind: history.OriginalOffered, TitleID: d.ID, VersionID: n.versionID,
			Message: n.name + " has the Original Language only: accept or dismiss it in Needs attention",
		})
	}
	return nil
}

// Offers lists every Original Offer, dismissed ones included, newest first.
func (s *Service) Offers(ctx context.Context) ([]Offer, error) {
	rows, err := db.New(s.st.Read()).ListOriginalOffers(ctx)
	if err != nil {
		return nil, err
	}
	byTitle := map[int64]map[int64][]db.OriginalOffer{}
	titleOf := map[int64]int64{}
	var titles []int64
	for _, r := range rows {
		tid, ok := titleOf[r.VersionID]
		if !ok {
			if tid, err = s.lib.TitleOfVersion(ctx, r.VersionID); errors.Is(err, library.ErrNotFound) {
				continue
			} else if err != nil {
				return nil, err
			}
			titleOf[r.VersionID] = tid
		}
		if byTitle[tid] == nil {
			byTitle[tid] = map[int64][]db.OriginalOffer{}
			titles = append(titles, tid)
		}
		byTitle[tid][r.VersionID] = append(byTitle[tid][r.VersionID], r)
	}
	if len(titles) == 0 {
		return nil, nil
	}
	rd, err := s.offerReader(ctx)
	if err != nil {
		return nil, err
	}
	var out []Offer
	for _, tid := range titles {
		d, err := s.lib.Get(ctx, tid, rd.view)
		if errors.Is(err, library.ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		got, err := s.titleOffers(ctx, rd, d, byTitle[tid])
		if err != nil {
			return nil, err
		}
		out = append(out, got...)
	}
	slices.SortStableFunc(out, func(a, b Offer) int { return b.FoundAt.Compare(a.FoundAt) })
	return out, nil
}

// OffersOfTitle are a Title's Original Offers by Version id. It reads that
// Title's offers alone, so a Title page does not pay for every offer.
func (s *Service) OffersOfTitle(ctx context.Context, titleID int64) (map[int64]Offer, error) {
	region, _, err := s.prof.Region(ctx)
	if err != nil {
		return nil, err
	}
	d, err := s.lib.Get(ctx, titleID, library.View{Country: region.Country, Now: s.clock()})
	if err != nil {
		return nil, err
	}
	rows := map[int64][]db.OriginalOffer{}
	q := db.New(s.st.Read())
	for _, v := range d.Versions {
		if rows[v.ID], err = q.ListOriginalOffersOfVersion(ctx, v.ID); err != nil {
			return nil, err
		}
	}
	out := map[int64]Offer{}
	if !slices.ContainsFunc(d.Versions, func(v library.Version) bool { return len(rows[v.ID]) > 0 }) {
		return out, nil
	}
	rd, err := s.offerReader(ctx)
	if err != nil {
		return nil, err
	}
	all, err := s.titleOffers(ctx, rd, d, rows)
	if err != nil {
		return nil, err
	}
	for _, o := range all {
		out[o.VersionID] = o
	}
	return out, nil
}

// offerReader is what building Offers from their rows needs beyond a Title:
// which Profiles still offer and what the active Grabs hold.
type offerReader struct {
	view     library.View
	offering map[string]bool
	busy     map[int64]bool
	covered  map[[2]int64]bool
}

func (s *Service) offerReader(ctx context.Context) (offerReader, error) {
	region, _, err := s.prof.Region(ctx)
	if err != nil {
		return offerReader{}, err
	}
	all, err := s.prof.List(ctx)
	if err != nil {
		return offerReader{}, err
	}
	rd := offerReader{view: library.View{Country: region.Country, Now: s.clock()}, offering: map[string]bool{}}
	for _, p := range all {
		rd.offering[p.Key] = p.Rule == scoring.PrimaryLanguage && p.OriginalLanguage == scoring.OriginalOffer
	}
	if rd.busy, err = s.busyVersions(ctx); err != nil {
		return offerReader{}, err
	}
	if rd.covered, err = s.coveredEpisodes(ctx); err != nil {
		return offerReader{}, err
	}
	return rd, nil
}

// titleOffers builds a Title's Offers from its stored rows by Version: only
// Versions whose Profile still offers, and only units that are still Wanted
// with no active Grab.
func (s *Service) titleOffers(ctx context.Context, rd offerReader, d library.Detail, rows map[int64][]db.OriginalOffer) ([]Offer, error) {
	episodes := map[int64]library.Episode{}
	if d.Kind == library.Series {
		eps, err := s.lib.Episodes(ctx, d.ID, rd.view)
		if err != nil {
			return nil, err
		}
		for _, ep := range eps {
			episodes[ep.ID] = ep
		}
	}
	var out []Offer
	for _, v := range d.Versions {
		if !rd.offering[v.Profile] {
			continue
		}
		var live []db.OriginalOffer
		for _, r := range rows[v.ID] {
			if d.Kind == library.Series {
				ep, ok := episodes[r.EpisodeID.Int64]
				c := ep.Cells[v.Slot]
				if !ok || c == nil || c.State != library.Wanted || rd.covered[[2]int64{v.ID, ep.ID}] {
					continue
				}
			} else if v.State != library.Wanted || rd.busy[v.ID] {
				continue
			}
			live = append(live, r)
		}
		dismissed := !slices.ContainsFunc(live, func(r db.OriginalOffer) bool { return r.Dismissed == 0 })
		if !dismissed {
			live = slices.DeleteFunc(live, func(r db.OriginalOffer) bool { return r.Dismissed == 1 })
		}
		o := Offer{TitleID: d.ID, Title: d.Title, VersionID: v.ID, Slot: v.Slot, Profile: v.Profile, Dismissed: dismissed}
		byRelease := map[string]*OfferedRelease{}
		var order []string
		for _, r := range live {
			key := strconv.FormatInt(r.IndexerID, 10) + "\x00" + r.ReleaseGuid
			rel := byRelease[key]
			if rel == nil {
				rel = &OfferedRelease{
					Name: r.ReleaseName, Indexer: r.IndexerName, Score: int(r.Score), Size: r.Size, PublishedAt: parseTime(r.PublishedAt),
					Pack: r.Pack == 1, row: r, series: d.Kind == library.Series, upgrade: v.File != nil,
				}
				byRelease[key] = rel
				order = append(order, key)
			}
			rel.rowIDs = append(rel.rowIDs, r.ID)
			if d.Kind == library.Series {
				ep := episodes[r.EpisodeID.Int64]
				season := ep.Season
				rel.Season = &season
				rel.Episodes = append(rel.Episodes, ep.Number)
				rel.episodeIDs = append(rel.episodeIDs, ep.ID)
				rel.upgrade = rel.upgrade || ep.Cells[v.Slot].HasFile
			}
			if at := parseTime(r.FoundAt); at.After(o.FoundAt) {
				o.FoundAt = at
			}
		}
		if len(order) == 0 {
			continue
		}
		for _, k := range order {
			rel := byRelease[k]
			slices.Sort(rel.Episodes)
			o.Releases = append(o.Releases, *rel)
		}
		slices.SortStableFunc(o.Releases, func(a, b OfferedRelease) int {
			return cmp.Or(cmp.Compare(b.Score, a.Score), cmp.Compare(*seasonOf(a), *seasonOf(b)), cmp.Compare(firstOf(a), firstOf(b)))
		})
		out = append(out, o)
	}
	return out, nil
}

func seasonOf(r OfferedRelease) *int {
	if r.Season == nil {
		zero := 0
		return &zero
	}
	return r.Season
}

func firstOf(r OfferedRelease) int {
	if len(r.Episodes) == 0 {
		return 0
	}
	return r.Episodes[0]
}

// offerOf finds the Version's Offer.
func (s *Service) offerOf(ctx context.Context, versionID int64) (Offer, error) {
	titleID, err := s.lib.TitleOfVersion(ctx, versionID)
	if err != nil {
		return Offer{}, err
	}
	all, err := s.OffersOfTitle(ctx, titleID)
	if err != nil {
		return Offer{}, err
	}
	o, ok := all[versionID]
	if !ok {
		return Offer{}, ErrNoOffer
	}
	return o, nil
}

// Accepted is what accepting an Offer grabbed.
type Accepted struct {
	Grabs []Grab
	// Failed counts the Releases that could not be grabbed.
	Failed int
}

// AcceptOffer grabs every Release of the Version's Offer, for the units it
// shows (see Offer.Dismissed), the same as "Grab anyway": exactly the Release
// offered, from what the offer stored, however
// old it is. A Release that is grabbed, or that its indexer no longer has or
// the Blocklist holds, leaves the offer; one that fails for another reason
// (the download client is down, a spent budget) stays offered. When nothing
// could be grabbed the first failure is the error. A Version without an Offer
// is ErrNoOffer.
func (s *Service) AcceptOffer(ctx context.Context, versionID int64) (Accepted, error) {
	o, err := s.offerOf(ctx, versionID)
	if err != nil {
		return Accepted{}, err
	}
	var out Accepted
	var first error
	for _, rel := range o.Releases {
		g, err := s.acceptRelease(ctx, o, rel)
		var rej *RejectedError
		if err == nil || errors.Is(err, ErrReleaseGone) || errors.As(err, &rej) {
			if derr := s.eachOfferRow(ctx, rel.rowIDs, (*db.Queries).DeleteOriginalOffer); derr != nil {
				return out, derr
			}
		}
		if err != nil {
			out.Failed++
			if first == nil {
				first = err
			}
			continue
		}
		out.Grabs = append(out.Grabs, g)
	}
	if len(out.Grabs) == 0 && first != nil {
		return out, first
	}
	return out, nil
}

// acceptRelease sends one offered Release from what its row stored.
func (s *Service) acceptRelease(ctx context.Context, o Offer, rel OfferedRelease) (Grab, error) {
	r := rel.row
	raw := indexers.Release{
		Release: indexer.Release{
			GUID: r.ReleaseGuid, Title: r.ReleaseName, DownloadURL: r.DownloadUrl, Size: r.Size, PublishDate: parseTime(r.PublishedAt),
		},
		IndexerID: r.IndexerID, IndexerName: r.IndexerName,
	}
	if blocked, err := s.blocklisted(ctx, raw); err != nil {
		return Grab{}, err
	} else if blocked {
		return Grab{}, &RejectedError{Rejections: []scoring.Rejection{scoring.RejectBlocklisted}}
	}
	var parsed release.ParsedRelease
	var verdict scoring.Verdict
	if err := json.Unmarshal([]byte(r.Parsed), &parsed); err != nil {
		return Grab{}, err
	}
	if err := json.Unmarshal([]byte(r.Verdict), &verdict); err != nil {
		return Grab{}, err
	}
	e := &entry{id: newID(), titleID: o.TitleID, at: s.clock(), raw: raw, cand: Candidate{
		GUID: r.ReleaseGuid, IndexerID: strconv.FormatInt(r.IndexerID, 10), Parsed: parsed, Verdicts: map[Slot]scoring.Verdict{o.Slot: verdict},
		PublishDate: raw.PublishDate, Size: r.Size,
	}}
	out := outgoing{titleID: o.TitleID, versionID: o.VersionID, e: e, slot: o.Slot, media: downloads.Movie, upgrade: rel.upgrade, overridden: true}
	if rel.series {
		out.media, out.episodes = downloads.Series, rel.episodeIDs
	}
	return s.send(ctx, out)
}

// DismissOffer dismisses the units the Version's Offer shows: each stays
// dismissed until a higher-scoring Release is offered for it. A Version
// without an Offer is ErrNoOffer.
func (s *Service) DismissOffer(ctx context.Context, versionID int64) error {
	o, err := s.offerOf(ctx, versionID)
	if err != nil {
		return err
	}
	var ids []int64
	for _, rel := range o.Releases {
		ids = append(ids, rel.rowIDs...)
	}
	return s.eachOfferRow(ctx, ids, (*db.Queries).DismissOriginalOffer)
}

// eachOfferRow applies do to each offer row in one transaction.
func (s *Service) eachOfferRow(ctx context.Context, ids []int64, do func(*db.Queries, context.Context, int64) error) error {
	tx, err := s.st.Write().BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	q := db.New(tx)
	for _, id := range ids {
		if err := do(q, ctx, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}
