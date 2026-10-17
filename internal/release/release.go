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
// Fields shared by both kinds come first. Series parsing (Sonarr) adds its
// episode and pack fields to this struct.
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

// Parse parses a release name (a usenet post title, a folder or a file name).
// It returns ErrUnparseable when the name is not a release of that kind.
func Parse(name string, kind Kind) (ParsedRelease, error) {
	return parse(name, kind, false)
}

// ParseFolder is Parse for a folder name: a name that starts with the year
// ("2012 Movie") also parses, as Radarr does for directories.
func ParseFolder(name string, kind Kind) (ParsedRelease, error) {
	return parse(name, kind, true)
}

// ParsePath parses a file path: the file name first, then the directory and
// file name together, then the directory name (Radarr's ParseMoviePath).
// Only "/" separates path segments.
func ParsePath(path string, kind Kind) (ParsedRelease, error) {
	switch kind {
	case KindMovie:
		return parseMoviePath(path)
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
	default:
		return ParsedRelease{}, fmt.Errorf("%w: %q", ErrUnsupportedKind, kind)
	}
}
