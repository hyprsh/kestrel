package library

import (
	"context"
	"sort"
	"time"

	"github.com/hyprsh/kestrel/internal/library/db"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/slot"
)

// EntryState is where one Version of a Title stands for an Upcoming entry.
// A Grab in flight is live state the SPA reads off the queue, so it is not here.
type EntryState string

// The states of an entry's Version.
const (
	EntryNotOut   EntryState = "not_out"  // nothing to do until it airs or is released
	EntryWanted   EntryState = "wanted"   // out, monitored, and no file yet
	EntryImported EntryState = "imported" // a file fills it
)

// EntrySlot is the state of one of a Title's Versions for one entry. A Title
// with two Versions has two of these.
type EntrySlot struct {
	Slot      slot.Slot
	VersionID int64
	State     EntryState
	// WantedSince is set for a Wanted one; LongMissing says it has been Wanted
	// for more than LongMissingAfter.
	WantedSince *time.Time
	LongMissing bool
	// ParsedRelease is the JSON snapshot of the Release an Imported one's file
	// came from; "" otherwise or when the Import left none.
	ParsedRelease string
}

// Marker is what makes an episode worth a mention.
type Marker string

// The markers of an episode: the Series premiere (S01E01), a season premiere
// (the first episode TheTVDB lists for a season), a season finale (the last one
// it lists) and a Special (season 0).
const (
	SeriesPremiere Marker = "series_premiere"
	SeasonPremiere Marker = "season_premiere"
	SeasonFinale   Marker = "season_finale"
	Special        Marker = "special"
)

// TypedDate is one of a Movie's release dates.
type TypedDate struct {
	Type ReleaseType
	Date time.Time
}

// UpcomingEntry is one line of the timeline: a monitored episode airing, or
// one typed release date of a monitored Movie, with where each of the Title's
// Versions stands.
type UpcomingEntry struct {
	Date      time.Time // midnight UTC of the day
	Kind      Kind
	TitleID   int64
	Title     string
	Year      int // 0 when unknown
	HasPoster bool
	Network   string // a Series' network; "" when unknown
	// Overview is the episode's synopsis, else the Title's; "" when none.
	Overview string
	// Slots has one entry per Version of the Title, Standard first.
	Slots []EntrySlot

	// Movies.
	ReleaseType ReleaseType
	// SearchableFrom is the day the Movie becomes searchable in the release-date
	// country; zero when no date is known. Released says that day has come.
	SearchableFrom time.Time
	Released       bool
	// Searchable marks the release that makes the Movie searchable: its digital
	// or physical date on SearchableFrom.
	Searchable bool
	// Dates are all the Movie's typed release dates in that country, earliest first.
	Dates []TypedDate

	// Episodes.
	EpisodeID       int64
	Season, Episode int
	EpisodeName     string
	// AirAt is when the episode airs, known when the Series has an air time.
	AirAt   *time.Time
	Markers []Marker
}

// UndatedReason is why an Upcoming Title has no date.
type UndatedReason string

// What a Title with something expected but no date is waiting for.
const (
	NoAirDate     UndatedReason = "no_air_date"     // monitored episodes TheTVDB gives no air date
	NoReleaseDate UndatedReason = "no_release_date" // a Movie with no release date anywhere
	Announced     UndatedReason = "announced"       // a Series TheTVDB marks `upcoming`
)

// UndatedEntry is a monitored Title with something expected but no date yet.
type UndatedEntry struct {
	Kind      Kind
	TitleID   int64
	Title     string
	Year      int
	HasPoster bool
	Network   string
	Reason    UndatedReason
	// Episodes is how many monitored episodes have no air date (NoAirDate only).
	Episodes int
	Slots    []EntrySlot
}

// Agenda is what Upcoming lists for a window: the dated entries, and the
// Titles with no date yet, which do not depend on the window.
type Agenda struct {
	Entries []UpcomingEntry
	Undated []UndatedEntry
}

var movieReleases = []struct {
	typ   ReleaseType
	types []metadata.ReleaseType
}{
	{TheatricalRelease, []metadata.ReleaseType{metadata.TheatricalLimited, metadata.Theatrical}},
	{DigitalRelease, []metadata.ReleaseType{metadata.Digital}},
	{PhysicalRelease, []metadata.ReleaseType{metadata.Physical}},
}

// Upcoming is the agenda for the days from..to, both included (Settled 18):
// monitored episodes airing then, and each monitored Movie's theatrical,
// digital and physical dates in the release-date country (with the usual
// fallback) that fall then, each with where every Version of the Title stands.
// A Movie date that is today or later is listed only while a Version holds no
// file; an earlier one stays once the Movie is filled, as does an episode.
// Oldest first. Undated lists the monitored Titles with something expected but
// no date yet.
func (s *Service) Upcoming(ctx context.Context, view View, from, to time.Time) (Agenda, error) {
	from, to = dayOf(from), dayOf(to)
	today := dayOf(view.Now)
	q := db.New(s.st.Read())
	titles, err := q.ListTitles(ctx)
	if err != nil {
		return Agenda{}, err
	}
	versions, err := q.ListVersions(ctx)
	if err != nil {
		return Agenda{}, err
	}
	files, err := q.ListFiles(ctx)
	if err != nil {
		return Agenda{}, err
	}
	misfits, err := misfitSet(ctx, q)
	if err != nil {
		return Agenda{}, err
	}
	dates, err := q.ListAllReleaseDates(ctx)
	if err != nil {
		return Agenda{}, err
	}
	allEps, err := q.ListEpisodes(ctx)
	if err != nil {
		return Agenda{}, err
	}
	fileEps, err := q.ListFileEpisodes(ctx)
	if err != nil {
		return Agenda{}, err
	}
	epReleases, err := q.ListFileEpisodeReleases(ctx)
	if err != nil {
		return Agenda{}, err
	}
	firstFiled, err := q.ListFirstFiled(ctx)
	if err != nil {
		return Agenda{}, err
	}

	hasFile := map[int64]bool{}
	movieFile := map[int64]string{} // a Movie Version's parsed release
	for _, f := range files {
		if misfits[f.ID] {
			continue
		}
		hasFile[f.VersionID] = true
		movieFile[f.VersionID] = f.ParsedRelease.String
	}
	versionsOf := map[int64][]db.Version{}
	for _, v := range versions {
		versionsOf[v.TitleID] = append(versionsOf[v.TitleID], v)
	}
	datesOf := map[int64][]db.TitleReleaseDate{}
	for _, d := range dates {
		datesOf[d.TitleID] = append(datesOf[d.TitleID], d)
	}
	epsOf := map[int64][]db.Episode{}
	for _, e := range allEps {
		epsOf[e.TitleID] = append(epsOf[e.TitleID], e)
	}
	var fe []fileEp
	for _, r := range fileEps {
		fe = append(fe, fileEp{r.VersionID, r.EpisodeID, r.Score})
	}
	heldBy := heldOf(fe)
	parsedOf := map[[2]int64]string{} // (version, episode) -> parsed release
	for _, r := range epReleases {
		parsedOf[[2]int64{r.VersionID, r.EpisodeID}] = r.ParsedRelease.String
	}
	filed := filedOf(firstFiled)

	// slotOfState turns a Unit's state at now into an entry's.
	slotOfState := func(v db.Version, st State, since *time.Time, parsed string) EntrySlot {
		es := EntrySlot{Slot: slotOf(v.Slot), VersionID: v.ID, State: EntryNotOut}
		switch st {
		case Filled:
			es.State, es.ParsedRelease = EntryImported, parsed
		case Wanted:
			es.State, es.WantedSince, es.LongMissing = EntryWanted, since, IsLongMissing(st, since, view.Now)
		}
		return es
	}

	var out Agenda
	for _, t := range titles {
		if t.Monitored != 1 {
			continue
		}
		base := UpcomingEntry{
			Kind: Kind(t.Kind), TitleID: t.ID, Title: t.Title, Year: int(t.Year.Int64),
			HasPoster: t.PosterPath.String != "", Network: t.Network, Overview: t.Overview,
		}
		undated := UndatedEntry{
			Kind: base.Kind, TitleID: t.ID, Title: t.Title, Year: base.Year, HasPoster: base.HasPoster, Network: t.Network,
		}
		vs := versionsOf[t.ID]
		if base.Kind == Movie {
			rel := releaseDatesOf(datesOf[t.ID])
			movieSlots := func() []EntrySlot {
				var slots []EntrySlot
				for _, v := range vs {
					st, since := StateAt(Unit{Monitored: true, HasFile: hasFile[v.ID], AddedAt: parseTime(v.AddedAt), Released: movieReleased(rel, view.Country, t.ReleaseSeenAt)}, view.Now)
					slots = append(slots, slotOfState(v, st, since, movieFile[v.ID]))
				}
				return slots
			}
			unfilled := false
			for _, v := range vs {
				unfilled = unfilled || !hasFile[v.ID]
			}
			if _, dated := rel.Released(""); !dated && unfilled {
				undated.Reason, undated.Slots = NoReleaseDate, movieSlots()
				out.Undated = append(out.Undated, undated)
				continue
			}
			scope := rel.ScopeFor(view.Country)
			var searchable time.Time
			released := false
			if at, ok := rel.Released(view.Country); ok {
				searchable, released = dayOf(at), !at.After(view.Now)
			}
			typed := map[ReleaseType]time.Time{}
			var all []TypedDate
			for _, r := range movieReleases {
				var best time.Time
				found := false
				for _, ty := range r.types {
					if d, ok := scope.Date(ty, view.Country); ok && (!found || d.Before(best)) {
						best, found = d, true
					}
				}
				if found {
					typed[r.typ] = dayOf(best)
					all = append(all, TypedDate{Type: r.typ, Date: dayOf(best)})
				}
			}
			sort.SliceStable(all, func(i, j int) bool { return all[i].Date.Before(all[j].Date) })
			for _, r := range movieReleases {
				day, found := typed[r.typ]
				if !found || day.Before(from) || day.After(to) || (!day.Before(today) && !unfilled) {
					continue
				}
				e := base
				e.Date, e.ReleaseType, e.SearchableFrom, e.Released, e.Dates = day, r.typ, searchable, released, all
				e.Searchable = r.typ != TheatricalRelease && !searchable.IsZero() && day.Equal(searchable)
				e.Slots = movieSlots()
				out.Entries = append(out.Entries, e)
			}
			continue
		}

		// A Series.
		clock := airClockOf(t)
		eps := epsOf[t.ID]
		released := releasedOf(eps, filed, clock)
		markers := markersOf(eps)
		var noDate []db.Episode
		for _, e := range eps {
			if e.Monitored != 1 {
				continue
			}
			day := parseDate(e.AirDate)
			if day == nil {
				if e.Season > 0 && !e.PlaceholderAt.Valid {
					noDate = append(noDate, e)
				}
				continue
			}
			if day.Before(from) || day.After(to) {
				continue
			}
			ent := base
			ent.Date, ent.Released = *day, true
			ent.EpisodeID, ent.Season, ent.Episode, ent.EpisodeName = e.ID, int(e.Season), int(e.Number), e.Name
			if e.Overview != "" {
				ent.Overview = e.Overview
			}
			if clock.known() {
				at := clock.moment(*day)
				ent.AirAt = &at
			}
			ent.Markers = markers[e.ID]
			for _, v := range vs {
				_, held := heldBy[v.ID][e.ID]
				st, since := StateAt(Unit{Monitored: true, HasFile: held, AddedAt: parseTime(v.AddedAt), Released: released[e.ID]}, view.Now)
				ent.Slots = append(ent.Slots, slotOfState(v, st, since, parsedOf[[2]int64{v.ID, e.ID}]))
			}
			out.Entries = append(out.Entries, ent)
		}
		switch {
		case len(noDate) > 0:
			undated.Reason, undated.Episodes = NoAirDate, len(noDate)
			for _, v := range vs {
				units := make([]Unit, 0, len(noDate))
				for _, e := range noDate {
					_, held := heldBy[v.ID][e.ID]
					units = append(units, Unit{Monitored: true, HasFile: held, AddedAt: parseTime(v.AddedAt), Released: released[e.ID]})
				}
				st, since := SeriesState(units, view.Now)
				undated.Slots = append(undated.Slots, slotOfState(v, st, since, ""))
			}
			out.Undated = append(out.Undated, undated)
		case t.TvdbStatus == "upcoming":
			undated.Reason = Announced
			for _, v := range vs {
				undated.Slots = append(undated.Slots, slotOfState(v, Unreleased, nil, ""))
			}
			out.Undated = append(out.Undated, undated)
		}
	}
	sort.SliceStable(out.Entries, func(i, j int) bool {
		a, b := out.Entries[i], out.Entries[j]
		if !a.Date.Equal(b.Date) {
			return a.Date.Before(b.Date)
		}
		if a.Title != b.Title {
			return a.Title < b.Title
		}
		if a.Season != b.Season {
			return a.Season < b.Season
		}
		return a.Episode < b.Episode
	})
	sort.SliceStable(out.Undated, func(i, j int) bool { return out.Undated[i].Title < out.Undated[j].Title })
	return out, nil
}

// markersOf is the markers of each episode of one Series, by episode id.
// Placeholder Episodes are not listed by TheTVDB and neither start nor end a season.
func markersOf(eps []db.Episode) map[int64][]Marker {
	first, last := map[int64]int64{}, map[int64]int64{}
	for _, e := range eps {
		if e.PlaceholderAt.Valid {
			continue
		}
		if n, ok := first[e.Season]; !ok || e.Number < n {
			first[e.Season] = e.Number
		}
		if n, ok := last[e.Season]; !ok || e.Number > n {
			last[e.Season] = e.Number
		}
	}
	out := map[int64][]Marker{}
	for _, e := range eps {
		if e.PlaceholderAt.Valid {
			continue
		}
		var ms []Marker
		switch {
		case e.Season == 0:
			ms = append(ms, Special)
		case e.Season == 1 && e.Number == first[1]:
			ms = append(ms, SeriesPremiere)
		case e.Number == first[e.Season]:
			ms = append(ms, SeasonPremiere)
		}
		if e.Season > 0 && e.Number == last[e.Season] && last[e.Season] != first[e.Season] {
			ms = append(ms, SeasonFinale)
		}
		out[e.ID] = ms
	}
	return out
}
