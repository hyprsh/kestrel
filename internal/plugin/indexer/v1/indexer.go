// Package indexer is the indexer.v1 plugin contract (ADR 0008): ask an indexer
// what it can search, search it (by ID, by text, or as an RSS feed) and fetch a
// release's NZB. Every type is plain data and every call stateless; the host
// passes the instance's Connection each time.
//
// One Search call is one request to the indexer. Paging, falling back from an ID
// search to a text search and pacing belong to the host, which reads Caps to
// know which parameters the indexer accepts.
//
// Changes within v1 are additive (new fields with usable zero values). A
// breaking change is a new package, indexer.v2.
package indexer

import (
	"context"
	"time"

	"github.com/hyprsh/kestrel/internal/plugin"
)

// Contract is how indexer.v1 registers. Any number of instances may be enabled.
var Contract = plugin.Contract{ID: "indexer.v1"}

// Indexer is an indexer adapter.
type Indexer interface {
	plugin.Plugin

	// Caps reports what the indexer can search and how big a page it serves.
	Caps(ctx context.Context, conn plugin.Connection) (Caps, error)

	// Search runs one search request. A spent request budget is a rate_limited
	// Error with Limit "search" and RetryAfter when the indexer says.
	Search(ctx context.Context, conn plugin.Connection, q SearchQuery) (SearchResult, error)

	// Fetch downloads the NZB at a Release's DownloadURL. A release the indexer no
	// longer has is not_found; a spent download budget is rate_limited with Limit "grab".
	Fetch(ctx context.Context, conn plugin.Connection, downloadURL string) ([]byte, error)
}

// SearchCaps says whether one kind of search is offered and which parameters it takes.
type SearchCaps struct {
	Available bool `json:"available"`
	// Params are the parameter names the indexer accepts ("q", "imdbid", "tmdbid",
	// "tvdbid", "season", "ep", ...). Empty when the indexer does not say.
	Params []string `json:"params"`
}

// Category is one indexer category.
type Category struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

// Caps is what an indexer can do.
type Caps struct {
	// PageSize is the number of results a request returns by default and MaxPageSize
	// the most it will return; 0 when the indexer does not say.
	PageSize    int `json:"page_size"`
	MaxPageSize int `json:"max_page_size"`
	// Text is the plain text search, Movie the Movie search and TV the Series search.
	Text       SearchCaps `json:"text"`
	Movie      SearchCaps `json:"movie"`
	TV         SearchCaps `json:"tv"`
	Categories []Category `json:"categories"`
}

// Media says which kind of Title a search is for. It picks the category set.
type Media string

const (
	MediaMovie Media = "movie"
	MediaTV    Media = "tv"
)

// Mode says how a search looks for releases.
type Mode string

const (
	// ModeIDs searches by the external IDs set on the query (Movie or Series search).
	ModeIDs Mode = "ids"
	// ModeText searches the indexer's free text index for Text.
	ModeText Mode = "text"
	// ModeRSS lists the newest releases of the media's categories, newest first.
	ModeRSS Mode = "rss"
)

// SearchQuery is one request. Zero-valued fields are left out of the request.
type SearchQuery struct {
	Media Media `json:"media"`
	Mode  Mode  `json:"mode"`
	// Text is the free text (ModeText), or an optional title hint for ModeIDs.
	Text string `json:"text"`
	// IMDBID is "tt" followed by digits; TMDBID and TVDBID are the numeric IDs.
	IMDBID string `json:"imdb_id"`
	TMDBID int    `json:"tmdb_id"`
	TVDBID int    `json:"tvdb_id"`
	// Season and Episode are sent as given ("1", "12", "2024" and "03/15" for a
	// daily show); "0" (specials) is sent as the "00" indexers expect. Empty means
	// not set, so a season pack is Season without Episode.
	Season  string `json:"season"`
	Episode string `json:"episode"`
	// Categories overrides the instance's category set for this Media.
	Categories []int `json:"categories"`
	// Offset and Limit page the result; Limit 0 leaves the indexer's default.
	Offset int `json:"offset"`
	Limit  int `json:"limit"`
}

// Limits is the quota an indexer reported with an answer. The zero value means
// it reported none.
type Limits struct {
	Reported    bool `json:"reported"`
	APICurrent  int  `json:"api_current"`
	APIMax      int  `json:"api_max"`
	GrabCurrent int  `json:"grab_current"`
	GrabMax     int  `json:"grab_max"`
}

// SearchResult is one page of releases.
type SearchResult struct {
	Releases []Release `json:"releases"`
	// Offset and Total place the page in the full result; Total is 0 when unknown.
	Offset int    `json:"offset"`
	Total  int    `json:"total"`
	Limits Limits `json:"limits"`
}

// Release is one release an indexer offers.
type Release struct {
	// GUID is stable per indexer: the key for de-duplication and the Blocklist.
	GUID  string `json:"guid"`
	Title string `json:"title"`
	// DownloadURL is what Fetch takes; InfoURL is the indexer's page for the release.
	DownloadURL string `json:"download_url"`
	InfoURL     string `json:"info_url"`
	// PublishDate is when the release was posted to Usenet, falling back to the feed date.
	PublishDate time.Time `json:"publish_date"`
	Size        int64     `json:"size"`
	Categories  []int     `json:"categories"`
	// IMDBID is "tt" followed by digits; the numeric IDs are 0 when the indexer gives none.
	IMDBID string `json:"imdb_id"`
	TMDBID int    `json:"tmdb_id"`
	TVDBID int    `json:"tvdb_id"`
	// Season and Episode are the numbers as text without an "S"/"E" prefix or
	// leading zeros ("1", "12"; "0" for specials), empty when absent.
	Season  string `json:"season"`
	Episode string `json:"episode"`
	// Languages are the names the indexer gives; they beat what the name parser guesses.
	Languages []string `json:"languages"`
	Grabs     int      `json:"grabs"`
	// Scene marks a pre-matched scene release; Nuked one the scene pulled.
	Scene bool `json:"scene"`
	Nuked bool `json:"nuked"`
	// Password is the indexer's password flag: 0 none, anything else is suspect.
	Password int    `json:"password"`
	Files    int    `json:"files"`
	Group    string `json:"group"`
}
