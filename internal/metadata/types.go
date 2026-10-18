// Package metadata talks to the metadata providers. For now that is TMDB, the
// source of Movies and of add-search for both kinds (ADR 0002); TheTVDB joins
// with the Series ticket.
//
// It is a leaf over `settings`: it fetches, parses and normalises, and
// persists nothing. The `library` module stores what it returns.
package metadata

import (
	"sort"
	"strings"
	"time"
)

// Kind is what a provider result is: a Movie or a Series.
type Kind string

const (
	Movie  Kind = "movie"
	Series Kind = "series"
)

// SearchResult is one hit of the add-search.
type SearchResult struct {
	Kind          Kind
	TMDBID        int
	Title         string
	OriginalTitle string
	Year          int // 0 when unknown
	PosterPath    string
	Overview      string
}

// ReleaseType is TMDB's release-date type.
type ReleaseType int

const (
	Premiere ReleaseType = iota + 1
	TheatricalLimited
	Theatrical
	Digital
	Physical
	TV
)

// ReleaseDate is one dated, certified release of a Movie in a country.
type ReleaseDate struct {
	Country       string // ISO 3166-1 alpha-2
	Type          ReleaseType
	Date          time.Time
	Certification string // "" when TMDB has none
}

// ReleaseDates is every release TMDB lists for a Movie, in any country. The
// lookups below share one fallback: the country asked for, then the US, then
// the earliest anywhere.
type ReleaseDates []ReleaseDate

// Date is the date of one release type for a country, with that fallback.
func (r ReleaseDates) Date(t ReleaseType, country string) (time.Time, bool) {
	pick := func(match func(ReleaseDate) bool) (time.Time, bool) {
		var best time.Time
		found := false
		for _, d := range r {
			if d.Type == t && match(d) && (!found || d.Date.Before(best)) {
				best, found = d.Date, true
			}
		}
		return best, found
	}
	if d, ok := pick(func(d ReleaseDate) bool { return d.Country == country }); ok {
		return d, true
	}
	if d, ok := pick(func(d ReleaseDate) bool { return d.Country == "US" }); ok {
		return d, true
	}
	return pick(func(ReleaseDate) bool { return true })
}

// TheatricalToHome is how long after a theatrical release a Movie with no digital
// or physical date is taken to be available.
const TheatricalToHome = 90 * 24 * time.Hour

// Released is when the Movie became searchable in a country: its earliest
// digital or physical date, else its theatrical date plus 90 days (a Radarr
// "minimum availability" replacement), else its premiere plus 90 days, else
// its TV date. All of it is read in one country: the one asked for, or the US
// only when that country has no dates at all, or else any.
func (r ReleaseDates) Released(country string) (time.Time, bool) {
	scope := r.scopeFor(country)
	earliest := func(types ...ReleaseType) (time.Time, bool) {
		var best time.Time
		found := false
		for _, t := range types {
			if d, ok := scope.Date(t, country); ok && (!found || d.Before(best)) {
				best, found = d, true
			}
		}
		return best, found
	}
	if d, ok := earliest(Digital, Physical); ok {
		return d, true
	}
	if d, ok := earliest(TheatricalLimited, Theatrical); ok {
		return d.Add(TheatricalToHome), true
	}
	if d, ok := earliest(Premiere); ok {
		return d.Add(TheatricalToHome), true
	}
	return earliest(TV)
}

// scopeFor is the dates of the country, or of the US if the country has none,
// or else all of them.
func (r ReleaseDates) scopeFor(country string) ReleaseDates {
	for _, c := range []string{country, "US"} {
		var in ReleaseDates
		for _, d := range r {
			if d.Country == c {
				in = append(in, d)
			}
		}
		if len(in) > 0 {
			return in
		}
	}
	return r
}

// Certification is the certification to read for a country, and the country it
// was read in: the country's own, else the US, else the earliest-released
// non-blank one anywhere. Callers need that country to interpret the rating
// (the Kids rule reads an age per country). Both are empty if nothing is certified.
func (r ReleaseDates) Certification(country string) (usedCountry, cert string) {
	of := func(c string) (string, bool) {
		var best *ReleaseDate
		for i := range r {
			d := &r[i]
			if d.Country == c && d.Certification != "" && (best == nil || d.Date.Before(best.Date)) {
				best = d
			}
		}
		if best == nil {
			return "", false
		}
		return best.Certification, true
	}
	if c, ok := of(country); ok {
		return country, c
	}
	if c, ok := of("US"); ok {
		return "US", c
	}
	sorted := append(ReleaseDates(nil), r...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Date.Before(sorted[j].Date) })
	for _, d := range sorted {
		if d.Certification != "" {
			return d.Country, d.Certification
		}
	}
	return "", ""
}

// Alias is an alternative title in a country.
type Alias struct {
	Country string
	Title   string
}

// Translation is a title in a language.
type Translation struct {
	Language string // ISO 639-1
	Country  string
	Title    string
}

// MovieDetails is everything Kestrel keeps about a Movie from TMDB.
type MovieDetails struct {
	TMDBID           int
	IMDbID           string
	Title            string // English
	OriginalTitle    string
	OriginalLanguage string // ISO 639-1
	Year             int    // 0 when unknown
	Runtime          int    // minutes, 0 when unknown
	Overview         string
	PosterPath       string
	ReleaseDates     ReleaseDates
	Aliases          []Alias
	Translations     []Translation
}

// TitleIn is the Movie's title in a language (ISO 639-1), or "" when TMDB has
// no non-empty translation.
func (d MovieDetails) TitleIn(language string) string {
	for _, t := range d.Translations {
		if strings.EqualFold(t.Language, language) && t.Title != "" {
			return t.Title
		}
	}
	return ""
}
