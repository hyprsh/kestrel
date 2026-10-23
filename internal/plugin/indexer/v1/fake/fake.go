// Package fake is the in-memory indexer.v1 indexer. Host tests (search, decide,
// the API) use it in place of a Newznab indexer; it passes the same conformance
// suite as the real adapters, so what a test sees is what the contract promises.
package fake

import (
	"context"
	"fmt"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/hyprsh/kestrel/internal/plugin"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
)

// ID is the fake's plugin id.
const ID = "fake_indexer"

// Indexer is an in-memory indexer. The zero value is not usable; use New.
type Indexer struct {
	apiKey string

	mu       sync.Mutex
	seq      int
	releases []indexer.Release
	nzbs     map[string][]byte // by download URL
	limits   map[string]time.Duration
	reported indexer.Limits
}

var _ indexer.Indexer = (*Indexer)(nil)

// New returns an indexer that accepts connections whose "api_key" is apiKey.
func New(apiKey string) *Indexer {
	return &Indexer{apiKey: apiKey, nzbs: map[string][]byte{}, limits: map[string]time.Duration{}}
}

// Conn returns a working connection to i. Set Config["unreachable"] to true on a copy to
// simulate an indexer that is down.
func (i *Indexer) Conn(id int64) plugin.Connection {
	return plugin.Connection{ID: id, Config: map[string]any{"api_key": i.apiKey}}
}

func (*Indexer) Describe() plugin.Manifest {
	return plugin.Manifest{
		ID: ID, Name: "In-memory fake indexer", Contract: indexer.Contract.ID, Version: "1",
		Capabilities: map[string][]string{"protocols": {"usenet"}},
		Fields: []plugin.Field{
			{Key: "api_key", Label: "API key", Type: plugin.FieldSecret, Required: true},
			{Key: "api_requests_per_day", Label: "API requests per day", Type: plugin.FieldInt},
			{Key: "grabs_per_day", Label: "Grabs per day", Type: plugin.FieldInt},
		},
	}
}

func (i *Indexer) check(conn plugin.Connection) error {
	if conn.Bool("unreachable") {
		return plugin.Errorf(plugin.CodeUnavailable, "the fake is down")
	}
	if conn.String("api_key") != i.apiKey {
		return plugin.Errorf(plugin.CodeAuth, "API key rejected")
	}
	return nil
}

func (i *Indexer) Test(_ context.Context, conn plugin.Connection) (plugin.TestResult, error) {
	if err := i.check(conn); err != nil {
		return plugin.TestResult{}, err
	}
	return plugin.TestResult{Message: "fake indexer"}, nil
}

func (i *Indexer) ListOptions(_ context.Context, conn plugin.Connection, field string) ([]plugin.Option, error) {
	if err := i.check(conn); err != nil {
		return nil, err
	}
	return nil, plugin.Errorf(plugin.CodeInvalid, "no live options for %q", field)
}

func (i *Indexer) Caps(_ context.Context, conn plugin.Connection) (indexer.Caps, error) {
	if err := i.check(conn); err != nil {
		return indexer.Caps{}, err
	}
	return indexer.Caps{
		PageSize: 100, MaxPageSize: 100,
		Text:  indexer.SearchCaps{Available: true, Params: []string{"q"}},
		Movie: indexer.SearchCaps{Available: true, Params: []string{"q", "imdbid", "tmdbid"}},
		TV:    indexer.SearchCaps{Available: true, Params: []string{"q", "tvdbid", "season", "ep"}},
		Categories: []indexer.Category{
			{ID: 2000, Name: "Movies"}, {ID: 2040, Name: "Movies/HD"}, {ID: 5000, Name: "TV"}, {ID: 5040, Name: "TV/HD"},
		},
	}, nil
}

func (i *Indexer) Search(_ context.Context, conn plugin.Connection, q indexer.SearchQuery) (indexer.SearchResult, error) {
	if err := i.check(conn); err != nil {
		return indexer.SearchResult{}, err
	}
	if q.Media != indexer.MediaMovie && q.Media != indexer.MediaTV {
		return indexer.SearchResult{}, plugin.Errorf(plugin.CodeInvalid, "unknown media %q", q.Media)
	}
	if q.Mode == indexer.ModeText && strings.TrimSpace(q.Text) == "" {
		return indexer.SearchResult{}, plugin.Errorf(plugin.CodeInvalid, "text search needs text")
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	if wait, spent := i.limits[plugin.LimitSearch]; spent {
		return indexer.SearchResult{}, &plugin.Error{Code: plugin.CodeRateLimited, Message: "Request limit reached", RetryAfter: wait, Limit: plugin.LimitSearch}
	}
	if wait, spent := i.limits[""]; spent {
		return indexer.SearchResult{}, &plugin.Error{Code: plugin.CodeRateLimited, Message: "Too many requests", RetryAfter: wait}
	}

	cats := q.Categories
	if len(cats) == 0 {
		cats = []int{2000}
		if q.Media == indexer.MediaTV {
			cats = []int{5000}
		}
	}
	var hits []indexer.Release
	for _, r := range i.releases {
		if !inCategories(r.Categories, cats) || !matches(r, q) {
			continue
		}
		hits = append(hits, r)
	}
	sort.SliceStable(hits, func(a, b int) bool { return hits[a].PublishDate.After(hits[b].PublishDate) })
	total := len(hits)
	if q.Offset > len(hits) {
		hits = nil
	} else {
		hits = hits[q.Offset:]
	}
	limit := q.Limit
	if limit <= 0 {
		limit = 100
	}
	if len(hits) > limit {
		hits = hits[:limit]
	}
	return indexer.SearchResult{Releases: append([]indexer.Release{}, hits...), Offset: q.Offset, Total: total, Limits: i.reported}, nil
}

// inCategories matches like Newznab: a parent id (2000) covers its sub-categories (2040).
func inCategories(have, want []int) bool {
	for _, h := range have {
		for _, w := range want {
			if h == w || (w%1000 == 0 && h/1000 == w/1000) {
				return true
			}
		}
	}
	return false
}

func matches(r indexer.Release, q indexer.SearchQuery) bool {
	switch q.Mode {
	case indexer.ModeText:
		return containsWords(r.Title, q.Text)
	case indexer.ModeRSS:
		return true
	}
	if q.IMDBID != "" && r.IMDBID != q.IMDBID {
		return false
	}
	if q.TMDBID != 0 && r.TMDBID != q.TMDBID {
		return false
	}
	if q.TVDBID != 0 && r.TVDBID != q.TVDBID {
		return false
	}
	if q.Season != "" && strings.TrimLeft(r.Season, "0") != strings.TrimLeft(q.Season, "0") {
		return false
	}
	if q.Episode != "" && strings.TrimLeft(r.Episode, "0") != strings.TrimLeft(q.Episode, "0") {
		return false
	}
	return true
}

func words(s string) []string {
	return strings.FieldsFunc(strings.ToLower(s), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
}

func containsWords(title, text string) bool {
	have := words(title)
	for _, w := range words(text) {
		if !slices.Contains(have, w) {
			return false
		}
	}
	return true
}

func (i *Indexer) Fetch(_ context.Context, conn plugin.Connection, downloadURL string) ([]byte, error) {
	if err := i.check(conn); err != nil {
		return nil, err
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	if wait, spent := i.limits[plugin.LimitGrab]; spent {
		return nil, &plugin.Error{Code: plugin.CodeRateLimited, Message: "Download limit reached", RetryAfter: wait, Limit: plugin.LimitGrab}
	}
	if wait, spent := i.limits[""]; spent {
		return nil, &plugin.Error{Code: plugin.CodeRateLimited, Message: "Too many requests", RetryAfter: wait}
	}
	data, ok := i.nzbs[downloadURL]
	if !ok {
		return nil, plugin.Errorf(plugin.CodeNotFound, "no such release")
	}
	return data, nil
}

// Publish makes the fake offer r with nzb behind its download URL
// (conformance.Backend). Publishing a title again replaces it.
func (i *Indexer) Publish(r indexer.Release, nzb []byte) error {
	i.mu.Lock()
	defer i.mu.Unlock()
	i.seq++
	r.GUID = fmt.Sprintf("fake-guid-%d", i.seq)
	r.DownloadURL = fmt.Sprintf("http://fake.invalid/getnzb/%d", i.seq)
	r.InfoURL = fmt.Sprintf("http://fake.invalid/details/%d", i.seq)
	i.drop(r.Title)
	i.releases = append(i.releases, r)
	i.nzbs[r.DownloadURL] = nzb
	return nil
}

// Remove takes the release titled title off the fake (conformance.Backend).
func (i *Indexer) Remove(title string) {
	i.mu.Lock()
	defer i.mu.Unlock()
	i.drop(title)
}

func (i *Indexer) drop(title string) {
	i.releases = slices.DeleteFunc(i.releases, func(r indexer.Release) bool {
		if r.Title == title {
			delete(i.nzbs, r.DownloadURL)
			return true
		}
		return false
	})
}

// Report makes every search answer carry l, as Newznab's apilimits element does.
func (i *Indexer) Report(l indexer.Limits) {
	i.mu.Lock()
	defer i.mu.Unlock()
	i.reported = l
}

// Exhaust spends a budget (conformance.Backend). The limit "" is a bare
// HTTP 429: both searches and downloads are refused, with no Limit on the Error.
func (i *Indexer) Exhaust(limit string, retryAfter time.Duration) {
	i.mu.Lock()
	defer i.mu.Unlock()
	i.limits[limit] = retryAfter
}

// Replenish clears every spent budget (conformance.Backend).
func (i *Indexer) Replenish() {
	i.mu.Lock()
	defer i.mu.Unlock()
	clear(i.limits)
	i.reported = indexer.Limits{}
}
