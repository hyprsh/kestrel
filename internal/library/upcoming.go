package library

import (
	"context"
	"database/sql"
	"sort"
	"time"

	"github.com/hyprsh/kestrel/internal/library/db"
	"github.com/hyprsh/kestrel/internal/metadata"
)

// ReleaseType is which release of a Movie an Upcoming entry dates.
type ReleaseType string

// The typed release dates Upcoming lists for a Movie.
const (
	TheatricalRelease ReleaseType = "theatrical"
	DigitalRelease    ReleaseType = "digital"
	PhysicalRelease   ReleaseType = "physical"
)

// UpcomingEntry is one line of the agenda: a monitored episode airing, or one
// typed release date of a monitored Movie that still lacks a file.
type UpcomingEntry struct {
	Date    time.Time // midnight UTC of the day
	Kind    Kind
	TitleID int64
	Title   string
	Year    int // 0 when unknown

	// Movies.
	ReleaseType ReleaseType
	// SearchableFrom is the day the Movie becomes searchable in the release-date
	// country; zero when no date is known. Released says that day has come.
	SearchableFrom time.Time
	Released       bool

	// Episodes.
	Season, Episode int
	EpisodeName     string
}

func dayOf(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

// UpcomingDays is how far past `from` the agenda looks when no end is asked for.
const UpcomingDays = 30

// UpcomingWindow is the agenda's days: from (today in UTC if not given) to
// `to` (UpcomingDays after from if not given).
func UpcomingWindow(now time.Time, from, to *time.Time) (time.Time, time.Time) {
	start := dayOf(now)
	if from != nil {
		start = *from
	}
	end := start.AddDate(0, 0, UpcomingDays)
	if to != nil {
		end = *to
	}
	return start, end
}

// Upcoming is the agenda for the days from..to, both included (Settled 18):
// monitored episodes airing then, and, for each monitored Movie with a Version
// that holds no file, its theatrical, digital and physical dates in the
// release-date country (with the usual fallback) that fall then. Oldest first.
func (s *Service) Upcoming(ctx context.Context, view View, from, to time.Time) ([]UpcomingEntry, error) {
	from, to = dayOf(from), dayOf(to)
	q := db.New(s.st.Read())
	titles, err := q.ListTitles(ctx)
	if err != nil {
		return nil, err
	}
	versions, err := q.ListVersions(ctx)
	if err != nil {
		return nil, err
	}
	files, err := q.ListFiles(ctx)
	if err != nil {
		return nil, err
	}
	misfits, err := misfitSet(ctx, q)
	if err != nil {
		return nil, err
	}
	dates, err := q.ListAllReleaseDates(ctx)
	if err != nil {
		return nil, err
	}
	airing, err := q.ListEpisodesAiring(ctx, db.ListEpisodesAiringParams{
		AirDate:   sql.NullString{String: from.Format(time.DateOnly), Valid: true},
		AirDate_2: sql.NullString{String: to.Format(time.DateOnly), Valid: true},
	})
	if err != nil {
		return nil, err
	}

	filled := map[int64]bool{}
	for _, f := range files {
		filled[f.VersionID] = filled[f.VersionID] || !misfits[f.ID]
	}
	unfilled := map[int64]bool{} // Titles with a Version holding no file
	for _, v := range versions {
		if !filled[v.ID] {
			unfilled[v.TitleID] = true
		}
	}
	datesOf := map[int64][]db.TitleReleaseDate{}
	for _, d := range dates {
		datesOf[d.TitleID] = append(datesOf[d.TitleID], d)
	}
	byID := map[int64]db.Title{}
	for _, t := range titles {
		byID[t.ID] = t
	}

	var out []UpcomingEntry
	for _, t := range titles {
		if t.Monitored != 1 || Kind(t.Kind) != Movie || !unfilled[t.ID] {
			continue
		}
		rel := releaseDatesOf(datesOf[t.ID])
		scope := rel.ScopeFor(view.Country)
		var searchable time.Time
		released := false
		if at, ok := rel.Released(view.Country); ok {
			searchable, released = dayOf(at), !at.After(view.Now)
		}
		for _, r := range []struct {
			typ   ReleaseType
			types []metadata.ReleaseType
		}{
			{TheatricalRelease, []metadata.ReleaseType{metadata.TheatricalLimited, metadata.Theatrical}},
			{DigitalRelease, []metadata.ReleaseType{metadata.Digital}},
			{PhysicalRelease, []metadata.ReleaseType{metadata.Physical}},
		} {
			var best time.Time
			found := false
			for _, ty := range r.types {
				if d, ok := scope.Date(ty, view.Country); ok && (!found || d.Before(best)) {
					best, found = d, true
				}
			}
			if day := dayOf(best); found && !day.Before(from) && !day.After(to) {
				out = append(out, UpcomingEntry{
					Date: day, Kind: Movie, TitleID: t.ID, Title: t.Title, Year: int(t.Year.Int64),
					ReleaseType: r.typ, SearchableFrom: searchable, Released: released,
				})
			}
		}
	}
	for _, e := range airing {
		t := byID[e.TitleID]
		day := parseDate(e.AirDate)
		if day == nil {
			continue
		}
		out = append(out, UpcomingEntry{
			Date: *day, Kind: Series, TitleID: t.ID, Title: t.Title, Year: int(t.Year.Int64), Released: true,
			Season: int(e.Season), Episode: int(e.Number), EpisodeName: e.Name,
		})
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i], out[j]
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
	return out, nil
}

// RecentImport is one Import in "Recently added".
type RecentImport struct {
	TitleID int64
	Title   string
	Year    int
	Kind    Kind
	Slot    string
	Release string
	Score   *int
	// ScoreDelta is what an Upgrade gained over the file it replaced; nil for a first Import.
	ScoreDelta *int
	Files      int // how many files the Import brought (a season pack brings many)
	IsUpgrade  bool
	ImportedAt time.Time
}

// RecentImports is the last n Imports, newest first; the files of one Grab
// count as one.
func (s *Service) RecentImports(ctx context.Context, n int) ([]RecentImport, error) {
	q := db.New(s.st.Read())
	// A pack can fill the window with one Import, so look at more files than rows.
	rows, err := q.ListRecentFiles(ctx, int64(n*20))
	if err != nil {
		return nil, err
	}
	var out []RecentImport
	byGrab := map[int64]int{}
	for _, r := range rows {
		if r.GrabID.Valid {
			if i, ok := byGrab[r.GrabID.Int64]; ok {
				out[i].Files++
				continue
			}
		}
		if len(out) == n {
			continue
		}
		t, err := q.GetTitle(ctx, r.TitleID)
		if err != nil {
			return nil, err
		}
		item := RecentImport{
			TitleID: t.ID, Title: t.Title, Year: int(t.Year.Int64), Kind: Kind(t.Kind), Slot: r.Slot, Release: r.ReleaseName,
			Files: 1, IsUpgrade: r.IsUpgrade == 1, ImportedAt: parseTime(r.ImportedAt),
		}
		if r.Score.Valid {
			v := int(r.Score.Int64)
			item.Score = &v
			if r.ReplacedScore.Valid {
				d := v - int(r.ReplacedScore.Int64)
				item.ScoreDelta = &d
			}
		}
		if r.GrabID.Valid {
			byGrab[r.GrabID.Int64] = len(out)
		}
		out = append(out, item)
	}
	return out, nil
}
