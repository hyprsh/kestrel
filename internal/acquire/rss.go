package acquire

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire/db"
	"github.com/hyprsh/kestrel/internal/downloads"
	"github.com/hyprsh/kestrel/internal/indexers"
	"github.com/hyprsh/kestrel/internal/library"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
)

// RSSOutcome is what one RSS pass did.
type RSSOutcome struct {
	// Grabbed are the Grabs it made.
	Grabbed []Grab
	// Failures are the indexers whose feed could not be read in full.
	Failures []indexers.Failure
}

// SyncRSS reads the RSS feed of every enabled indexer and grabs what the
// library wants from it, without searching. Each Release is matched to a
// monitored Title by name, alias and year (a Movie's year may be one off) and
// scored under the Profile of every Version the Title has; Decide then picks
// per Version. Unmonitored Titles and episodes get no Grabs, and a Release is
// taken before its Title counts as released. A Version or episode that an
// active Grab already fetches is left alone, so reading the same feed again
// changes nothing. Grabs that fail to send are joined into the error.
func (s *Service) SyncRSS(ctx context.Context) (RSSOutcome, error) {
	res := s.idx.RSS(ctx)
	out := RSSOutcome{Failures: res.Failures}
	if len(res.Releases) == 0 {
		return out, nil
	}
	named, err := s.lib.Names(ctx)
	if err != nil {
		return out, err
	}
	byTitle, order := matchFeed(res.Releases, named)

	var errs []error
	for _, id := range order {
		grabbed, err := s.rssTitle(ctx, id, byTitle[id])
		out.Grabbed = append(out.Grabbed, grabbed...)
		if err != nil {
			errs = append(errs, err)
		}
	}
	return out, errors.Join(errs...)
}

// feedItem is a Release of the feed matched to a Title.
type feedItem struct {
	raw    indexers.Release
	parsed release.ParsedRelease
}

// matchFeed groups the feed's Releases by the monitored Titles they name, in
// the order the Titles are first named.
func matchFeed(feed []indexers.Release, titles []library.Named) (map[int64][]feedItem, []int64) {
	names := map[library.Kind]map[string][]int{library.Movie: {}, library.Series: {}}
	for i, t := range titles {
		if !t.Monitored {
			continue
		}
		for _, n := range t.Names {
			k := normalize(n)
			if k != "" && !slices.Contains(names[t.Kind][k], i) {
				names[t.Kind][k] = append(names[t.Kind][k], i)
			}
		}
	}
	byTitle := map[int64][]feedItem{}
	var order []int64
	for _, r := range feed {
		kind, rk := library.Movie, release.KindMovie
		if r.Media == indexer.MediaTV {
			kind, rk = library.Series, release.KindSeries
		}
		parsed, err := release.Parse(r.Title, rk)
		if err != nil {
			continue // not a name that can be read
		}
		hits := map[int]bool{}
		for _, name := range parsedTitles(parsed) {
			for _, i := range names[kind][normalize(name)] {
				t := titles[i]
				if kind == library.Movie && !yearFits(parsed.Year, t.Year) {
					continue
				}
				hits[i] = true
			}
		}
		for i, t := range titles {
			if t.Monitored && t.Kind == kind && sameExternalID(r, t) {
				hits[i] = true
			}
		}
		// A Movie name without a year that fits several Titles (a remake) is a guess.
		if kind == library.Movie && parsed.Year == 0 && len(hits) > 1 {
			continue
		}
		for i := range hits {
			id := titles[i].ID
			if _, seen := byTitle[id]; !seen {
				order = append(order, id)
			}
			byTitle[id] = append(byTitle[id], feedItem{raw: r, parsed: parsed})
		}
	}
	return byTitle, order
}

func parsedTitles(p release.ParsedRelease) []string {
	out := slices.Clone(p.Titles)
	if s := p.Series; s != nil {
		out = append(out, s.TitleWithoutYear)
		out = append(out, s.AllTitles...)
	}
	return out
}

func yearFits(released, year int) bool {
	return released == 0 || year == 0 || (released >= year-1 && released <= year+1)
}

// sameExternalID is true when the indexer tagged the Release with the Title's
// external id, whatever the name says.
func sameExternalID(r indexers.Release, t library.Named) bool {
	return (r.IMDBID != "" && r.IMDBID == t.IMDbID) ||
		(t.Kind == library.Movie && r.TMDBID != 0 && r.TMDBID == t.TMDBID) ||
		(t.Kind == library.Series && r.TVDBID != 0 && r.TVDBID == t.TVDBID)
}

// rssTitle decides and grabs for one Title from the feed items that name it.
func (s *Service) rssTitle(ctx context.Context, titleID int64, items []feedItem) ([]Grab, error) {
	defer s.snap.Hold()()
	sub, err := s.subjectOf(ctx, titleID)
	if err != nil {
		return nil, err
	}
	if !sub.detail.Monitored {
		return nil, nil
	}
	if sub.detail.Kind == library.Series {
		return s.rssSeries(ctx, sub, items)
	}
	return s.rssMovie(ctx, sub, items)
}

// busyVersions are the Versions an active or stalled Grab already serves.
func (s *Service) busyVersions(ctx context.Context) (map[int64]bool, error) {
	active, err := s.Active(ctx)
	if err != nil {
		return nil, err
	}
	busy := map[int64]bool{}
	for _, a := range active {
		busy[a.VersionID] = true
	}
	// A Version whose Import is stalled still has its download.
	stalled, err := db.New(s.st.Read()).ListStalledGrabs(ctx)
	if err != nil {
		return nil, err
	}
	for _, g := range stalled {
		busy[g.VersionID.Int64] = true
	}
	return busy, nil
}

func (s *Service) rssMovie(ctx context.Context, sub subject, items []feedItem) ([]Grab, error) {
	d := sub.detail
	if err := s.releaseSeen(ctx, d, len(items)); err != nil {
		return nil, err
	}
	busy, err := s.busyVersions(ctx)
	if err != nil {
		return nil, err
	}
	var in Input
	versionOf := map[Slot]int64{}
	for _, v := range d.Versions {
		if busy[v.ID] {
			continue
		}
		u := Unit{}
		if v.File != nil {
			h := Held{Fits: !v.File.Misfit}
			if v.File.Score != nil {
				h.Score = *v.File.Score
			}
			u.Held = &h
		}
		versionOf[v.Slot] = v.ID
		in.Versions = append(in.Versions, Version{Slot: v.Slot, Units: []Unit{u}})
	}
	if len(in.Versions) == 0 {
		return nil, nil
	}
	title := scoring.Title{Name: d.Title, Year: d.Year, OriginalLanguage: release.LanguageByISO(d.OriginalLanguage)}
	entries := map[string]*entry{}
	now := s.clock()
	for _, it := range items {
		e, err := s.entryFor(ctx, sub, it.raw, it.parsed, title, now)
		if err != nil {
			return nil, err
		}
		entries[entryKey(e.cand)] = e
		in.Candidates = append(in.Candidates, e.cand)
	}
	var out []Grab
	plans, err := s.decide(ctx, in)
	if err != nil {
		return nil, err
	}
	var errs []error
	for _, plan := range plans {
		e := entries[entryKey(plan.Candidate)]
		g, err := s.send(ctx, outgoing{
			titleID: d.ID, versionID: versionOf[plan.Slot], e: e, slot: plan.Slot, media: downloads.Movie, upgrade: plan.Upgrade,
		})
		if err != nil {
			errs = append(errs, err)
			continue
		}
		out = append(out, g)
	}
	return out, errors.Join(errs...)
}

func entryKey(c Candidate) string { return c.GUID + "\x00" + c.IndexerID }

func (s *Service) rssSeries(ctx context.Context, sub subject, items []feedItem) ([]Grab, error) {
	d := sub.detail
	now := s.clock()
	episodes, err := s.lib.Episodes(ctx, d.ID, library.View{Now: now})
	if err != nil {
		return nil, err
	}
	covered, err := s.coveredEpisodes(ctx)
	if err != nil {
		return nil, err
	}

	var in Input
	in.SeasonsFinished = seasonsFinished(episodes, now)
	versionOf := map[Slot]int64{}
	for _, v := range d.Versions {
		ver := Version{Slot: v.Slot}
		for _, ep := range episodes {
			cell := ep.Cells[v.Slot]
			if cell == nil || !ep.Monitored || covered[[2]int64{v.ID, ep.ID}] {
				continue
			}
			u := Unit{Ref: EpisodeRef{ep.Season, ep.Number}}
			if cell.State == library.Filled {
				h := Held{Fits: true}
				if cell.Score != nil {
					h.Score = *cell.Score
				}
				u.Held = &h
			}
			ver.Units = append(ver.Units, u)
		}
		if len(ver.Units) > 0 {
			versionOf[v.Slot] = v.ID
			in.Versions = append(in.Versions, ver)
		}
	}
	if len(in.Versions) == 0 {
		return nil, nil
	}

	entries := map[string]*entry{}
	for _, it := range items {
		parsed, ok := resolveDaily(it.parsed, episodes)
		if !ok {
			continue
		}
		title := scoring.Title{
			Name: d.Title, Year: d.Year, OriginalLanguage: release.LanguageByISO(d.OriginalLanguage),
			EpisodeTitles: episodeTitles(parsed, episodes),
		}
		e, err := s.entryFor(ctx, sub, it.raw, parsed, title, now)
		if err != nil {
			return nil, err
		}
		entries[entryKey(e.cand)] = e
		in.Candidates = append(in.Candidates, e.cand)
	}

	idOf := map[EpisodeRef]int64{}
	for _, ep := range episodes {
		idOf[EpisodeRef{ep.Season, ep.Number}] = ep.ID
	}
	var out []Grab
	plans, err := s.decide(ctx, in)
	if err != nil {
		return nil, err
	}
	var errs []error
	for _, plan := range plans {
		e := entries[entryKey(plan.Candidate)]
		var covers []int64
		for _, ref := range plan.Covers {
			covers = append(covers, idOf[ref])
		}
		g, err := s.send(ctx, outgoing{
			titleID: d.ID, versionID: versionOf[plan.Slot], e: e, slot: plan.Slot, media: downloads.Series,
			episodes: covers, upgrade: plan.Upgrade,
		})
		if err != nil {
			errs = append(errs, err)
			continue
		}
		out = append(out, g)
	}
	return out, errors.Join(errs...)
}

// coveredEpisodes are the (Version, episode) pairs an active Grab is fetching.
func (s *Service) coveredEpisodes(ctx context.Context) (map[[2]int64]bool, error) {
	rows, err := db.New(s.st.Read()).ListActiveGrabEpisodes(ctx)
	if err != nil {
		return nil, err
	}
	out := map[[2]int64]bool{}
	for _, r := range rows {
		out[[2]int64{r.VersionID.Int64, r.EpisodeID}] = true
	}
	return out, nil
}

// seasonsFinished marks the seasons whose every episode is released (the
// Library's rule: aired, or for an undated episode a later one out).
func seasonsFinished(eps []library.Episode, now time.Time) map[int]bool {
	finished := map[int]bool{}
	for _, ep := range eps {
		done := ep.Released != nil && !ep.Released.After(now)
		if prev, seen := finished[ep.Season]; !seen {
			finished[ep.Season] = done
		} else {
			finished[ep.Season] = prev && done
		}
	}
	return finished
}

// resolveDaily turns a daily release (one that names an air date) into the
// episode that aired that day, so Decide can plan it like any single episode.
// It reports false for a daily release no single episode answers to. Other
// releases pass through.
func resolveDaily(p release.ParsedRelease, eps []library.Episode) (release.ParsedRelease, bool) {
	if !p.IsDaily() {
		return p, true
	}
	var match []library.Episode
	for _, ep := range eps {
		if ep.AirDate != nil && ep.AirDate.Format("2006-01-02") == p.Series.AirDate {
			match = append(match, ep)
		}
	}
	if len(match) != 1 {
		return p, false
	}
	info := *p.Series
	info.Season, info.Episodes, info.AirDate = match[0].Season, []int{match[0].Number}, ""
	p.Series = &info
	return p, true
}

// episodeTitles are the names of the episodes a single or multi-episode release covers.
func episodeTitles(p release.ParsedRelease, eps []library.Episode) []string {
	if p.Series == nil || p.Series.FullSeason {
		return nil
	}
	var out []string
	for _, ep := range eps {
		if ep.Season == p.Series.Season && slices.Contains(p.Series.Episodes, ep.Number) && ep.Name != "" {
			out = append(out, ep.Name)
		}
	}
	return out
}
