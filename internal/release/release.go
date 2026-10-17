// Package release parses release names the way Radarr and Sonarr do. It is a
// Go port of their parsers (ADR 0006): title, year, edition, quality
// (source, resolution, Proper/Repack), languages and release group come out
// as a ParsedRelease. Language, quality, release group and revision parsing
// are shared between kinds; title (and, for Series, episode and pack) parsing
// is kind specific.
//
// The parser is household-neutral. It recognises every *arr language and does
// not depend on a Primary Language; Original is kept for the scoring stage.
//
// Movie parsing is ported from Radarr v5.28.0.10274, see UpstreamRadarr.
// Series parsing is ported from Sonarr v4.0.20.3014, see UpstreamSonarr.
package release

import (
	"errors"
	"fmt"
)

// Upstream commits the ported code was taken from (PRD Settled 26). Each
// ported file repeats its commit in its header so a later re-sync is a diff.
const (
	// UpstreamRadarr is the last Radarr v5 release: tag v5.28.0.10274.
	UpstreamRadarr = "54cbbe05d976ac053744012f8b48d44e384e2d41"
	// UpstreamRadarrVersion is the release UpstreamRadarr belongs to.
	UpstreamRadarrVersion = "v5.28.0.10274"

	// UpstreamSonarr is the latest Sonarr v4 release: tag v4.0.20.3014.
	UpstreamSonarr = "cab419ade8ac7fcab5bf80394ee492abd35d5f5a"
	// UpstreamSonarrVersion is the release UpstreamSonarr belongs to.
	UpstreamSonarrVersion = "v4.0.20.3014"
)

// Kind says what a release name is parsed as. The kind breaks the tie where
// Radarr and Sonarr disagree about the same input.
type Kind string

const (
	KindMovie  Kind = "movie"
	KindSeries Kind = "series"
)

var (
	// ErrUnparseable means the name does not look like a release of that kind
	// (a hash, an obfuscated name, no title).
	ErrUnparseable = errors.New("release name cannot be parsed")
	// ErrUnsupportedKind is returned for a kind this build cannot parse.
	ErrUnsupportedKind = errors.New("release kind is not supported")
)

// ParsedRelease is what the parser read from a release name. It is plain data
// and round-trips through JSON, so it can be stored on files and Releases.
//
// Fields shared by both kinds come first. A Series name also fills Series with
// its season, episode, air date and pack fields; Series is nil for a Movie.
// For a Series, Titles[0] is the series title and Year is the year in it
// ("The Series 2016"), 0 if there is none.
//
// Quality.Quality IDs belong to the table of the kind that parsed the name:
// Radarr's for a Movie, Sonarr's for a Series. Languages come from one shared
// table (language.go), so compare them by value, not by Sonarr's own ids.
type ParsedRelease struct {
	Kind Kind `json:"kind"`

	// Titles holds the parsed Title first, then any alternative titles after
	// an AKA or "/" in the name.
	Titles []string `json:"titles"`
	Year   int      `json:"year,omitempty"`
	// Edition is the Movie edition ("Extended", "Directors Cut"), empty if none.
	Edition string `json:"edition,omitempty"`

	Quality QualityModel `json:"quality"`
	// Languages are the *arr languages found in the name, never empty:
	// Unknown when nothing was recognised. DL, ML and MULTi tokens yield
	// Original (and English for ML) exactly as Radarr does.
	Languages []Language `json:"languages"`

	ReleaseGroup  string `json:"releaseGroup,omitempty"`
	ReleaseHash   string `json:"releaseHash,omitempty"`
	HardcodedSubs string `json:"hardcodedSubs,omitempty"`
	ImdbID        string `json:"imdbId,omitempty"`
	TmdbID        int    `json:"tmdbId,omitempty"`

	// Part is the disc number of a multi-part Movie (CD1, CD2, Disc 2); 0 when
	// the name is a single piece. A Movie with Part > 0 is rejected as
	// invalid by Decide (Settled 24).
	Part int `json:"part,omitempty"`

	// Series is what a Series name says about the episodes it covers; nil for
	// a Movie.
	Series *SeriesInfo `json:"series,omitempty"`

	// The name as given, with the file extension removed, and with the Title
	// swapped for "A Movie" (the form language, group and edition parsing and
	// Custom Format matching see).
	OriginalTitle      string `json:"originalTitle"`
	ReleaseTitle       string `json:"releaseTitle"`
	SimpleReleaseTitle string `json:"simpleReleaseTitle"`
}

// Title returns the primary Title, empty if there is none.
func (p ParsedRelease) Title() string {
	if len(p.Titles) == 0 {
		return ""
	}
	return p.Titles[0]
}

// IsMultiPart reports whether the name is one piece of a multi-part Movie.
func (p ParsedRelease) IsMultiPart() bool { return p.Part > 0 }

// SeriesInfo is what a Series release name says about its episodes (Sonarr's
// ParsedEpisodeInfo). Season is 0 for specials, and for a daily episode, which
// carries AirDate instead of episode numbers.
type SeriesInfo struct {
	Season int `json:"season"`
	// Episodes lists the episode numbers of a single or multi-episode release
	// in order (S01E05-E07 is 5, 6, 7); empty for a pack or a daily episode.
	Episodes []int `json:"episodes,omitempty"`

	// AirDate is the date of a daily episode as YYYY-MM-DD; DailyPart numbers
	// the part of a daily episode that was released in several (1-9), 0 if
	// none.
	AirDate   string `json:"airDate,omitempty"`
	DailyPart int    `json:"dailyPart,omitempty"`

	// FullSeason marks a season pack (also a multi-season pack, see
	// MultiSeason, where Season is the first season). PartialSeason marks one
	// part of a split season pack, numbered by SeasonPart.
	FullSeason    bool `json:"fullSeason,omitempty"`
	PartialSeason bool `json:"partialSeason,omitempty"`
	SeasonPart    int  `json:"seasonPart,omitempty"`
	MultiSeason   bool `json:"multiSeason,omitempty"`
	// SeasonExtra marks an EXTRAS or SUBPACK pack.
	SeasonExtra bool `json:"seasonExtra,omitempty"`
	// SplitEpisode marks an episode released in pieces (S01E05a, S01E05b).
	SplitEpisode bool `json:"splitEpisode,omitempty"`
	// MiniSeries marks a name with episode numbers but no season (Part 2,
	// E05); Season is then 1.
	MiniSeries bool `json:"miniSeries,omitempty"`
	// Special marks a special (S00, "Special", S01E11.5 [SP]).
	Special bool `json:"special,omitempty"`

	// AbsoluteEpisodes and SpecialAbsoluteEpisodes are anime absolute episode
	// numbers. Kestrel does not support absolute numbering: they are parsed
	// because Sonarr's grammar needs them to tell such names apart, and
	// Decide rejects a name with IsAbsoluteNumbering.
	AbsoluteEpisodes        []int     `json:"absoluteEpisodes,omitempty"`
	SpecialAbsoluteEpisodes []float64 `json:"specialAbsoluteEpisodes,omitempty"`

	// TitleWithoutYear is the series title without a trailing year; AllTitles
	// lists the titles of a name that gives several ("Title / Other Title",
	// "Title AKA Other"), empty if it gives one.
	TitleWithoutYear string   `json:"titleWithoutYear,omitempty"`
	AllTitles        []string `json:"allTitles,omitempty"`

	// ReleaseTokens is the rest of the name after the season and episode
	// numbers, the text language parsing reads.
	ReleaseTokens string `json:"releaseTokens,omitempty"`
}

// SeriesReleaseType says what a Series release covers.
type SeriesReleaseType string

const (
	SeriesReleaseUnknown       SeriesReleaseType = "unknown"
	SeriesReleaseSingleEpisode SeriesReleaseType = "singleEpisode"
	SeriesReleaseMultiEpisode  SeriesReleaseType = "multiEpisode"
	SeriesReleaseSeasonPack    SeriesReleaseType = "seasonPack"
)

// IsDaily reports a daily episode: a name that carries an air date.
func (p ParsedRelease) IsDaily() bool { return p.Series != nil && p.Series.AirDate != "" }

// IsAbsoluteNumbering reports an anime name numbered by absolute episode.
func (p ParsedRelease) IsAbsoluteNumbering() bool {
	return p.Series != nil && len(p.Series.AbsoluteEpisodes) > 0
}

// IsSeasonPack reports a season pack, a multi-season pack or an EXTRAS pack.
func (p ParsedRelease) IsSeasonPack() bool { return p.Series != nil && p.Series.FullSeason }

// SeriesReleaseType ports Sonarr's ReleaseType: multi-episode, single episode,
// season pack or unknown.
func (p ParsedRelease) SeriesReleaseType() SeriesReleaseType {
	s := p.Series
	switch {
	case s == nil:
		return SeriesReleaseUnknown
	case len(s.Episodes) > 1 || len(s.AbsoluteEpisodes) > 1:
		return SeriesReleaseMultiEpisode
	case len(s.Episodes) == 1 || len(s.AbsoluteEpisodes) == 1:
		return SeriesReleaseSingleEpisode
	case s.FullSeason:
		return SeriesReleaseSeasonPack
	}
	return SeriesReleaseUnknown
}

// IsPossibleSpecialEpisode ports Sonarr's property of that name: a name that
// may be a special (no series title and no usable season and episode, a
// "Special" flag, or episode 0).
func (p ParsedRelease) IsPossibleSpecialEpisode() bool {
	s := p.Series
	if s == nil {
		return false
	}
	noTitle := isBlank(p.Title())
	return (s.AirDate == "" && noTitle && (len(s.Episodes) == 0 || s.Season == 0)) ||
		(!noTitle && s.Special) ||
		(len(s.Episodes) == 1 && s.Episodes[0] == 0)
}

// IsPossibleSceneSeasonSpecial reports episode 0 of a season other than 0.
func (p ParsedRelease) IsPossibleSceneSeasonSpecial() bool {
	s := p.Series
	return s != nil && s.Season != 0 && len(s.Episodes) == 1 && s.Episodes[0] == 0
}

// Parse parses a release name (a usenet post title, a folder or a file name).
// It returns ErrUnparseable when the name is not a release of that kind.
func Parse(name string, kind Kind) (ParsedRelease, error) {
	return parse(name, kind, false)
}

// ParseFolder is Parse for a folder name: a name that starts with the year
// ("2012 Movie") also parses, as Radarr does for directories. A Series folder
// name parses as Parse does.
func ParseFolder(name string, kind Kind) (ParsedRelease, error) {
	return parse(name, kind, true)
}

// ParsePath parses a file path: the file name first, then the directory and
// file name together, then the directory name (Radarr's ParseMoviePath and
// Sonarr's ParsePath, which also reads the season from a "Season 3" folder
// for a bare episode number). Only "/" separates path segments.
func ParsePath(path string, kind Kind) (ParsedRelease, error) {
	switch kind {
	case KindMovie:
		return parseMoviePath(path)
	case KindSeries:
		return parseSeriesPath(path)
	default:
		return ParsedRelease{}, fmt.Errorf("%w: %q", ErrUnsupportedKind, kind)
	}
}

func parse(name string, kind Kind, isDir bool) (ParsedRelease, error) {
	switch kind {
	case KindMovie:
		if p, ok := parseMovieTitle(name, isDir); ok {
			return p, nil
		}
		return ParsedRelease{}, ErrUnparseable
	case KindSeries:
		if p, ok := parseSeriesTitle(name); ok {
			return p, nil
		}
		return ParsedRelease{}, ErrUnparseable
	default:
		return ParsedRelease{}, fmt.Errorf("%w: %q", ErrUnsupportedKind, kind)
	}
}
