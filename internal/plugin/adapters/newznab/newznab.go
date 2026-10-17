// Package newznab is the Newznab adapter for indexer.v1. It is stateless: every
// call builds its requests from the Connection it is given. Newznab answers in
// XML (RSS 2.0 plus newznab attributes), which is all this adapter asks for.
//
// Spec: https://newznab.readthedocs.io/en/latest/misc/api/
package newznab

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/hyprsh/kestrel/internal/plugin"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
)

// ID is the plugin id.
const ID = "newznab"

const (
	defaultMovieCategories = "2000"
	defaultTVCategories    = "5000"
	// maxBody caps a response we are willing to read.
	maxBody = 64 << 20
)

// Client is the Newznab adapter.
type Client struct {
	http *http.Client
}

var _ indexer.Indexer = (*Client)(nil)

// New returns the adapter. A nil httpClient means a client with a 30 s timeout.
func New(httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 30 * time.Second}
	}
	return &Client{http: httpClient}
}

func (*Client) Describe() plugin.Manifest {
	return plugin.Manifest{
		ID: ID, Name: "Newznab", Contract: indexer.Contract.ID, Version: "1",
		Capabilities: map[string][]string{"protocols": {"usenet"}},
		Fields: []plugin.Field{
			{Key: "url", Label: "URL", Type: plugin.FieldURL, Required: true,
				Help: "The indexer's address, e.g. https://indexer.example. Kestrel adds /api."},
			{Key: "api_key", Label: "API key", Type: plugin.FieldSecret, Required: true,
				Help: "Your API key on the indexer."},
			{Key: "movie_categories", Label: "Movie categories", Type: plugin.FieldText, Default: defaultMovieCategories,
				Help: "Comma-separated category IDs searched for Movies. 2000 covers every Movies sub-category."},
			{Key: "tv_categories", Label: "Series categories", Type: plugin.FieldText, Default: defaultTVCategories,
				Help: "Comma-separated category IDs searched for Series. 5000 covers every TV sub-category."},
			{Key: "api_requests_per_day", Label: "API requests per day", Type: plugin.FieldInt,
				Help: "Leave empty for no limit. Kestrel stays under it by pausing searches."},
		},
	}
}

func (c *Client) Test(ctx context.Context, conn plugin.Connection) (plugin.TestResult, error) {
	caps, title, err := c.caps(ctx, conn)
	if err != nil {
		return plugin.TestResult{}, err
	}
	// Many indexers serve caps to anyone, so only a search proves the key.
	if _, err := c.Search(ctx, conn, indexer.SearchQuery{Media: indexer.MediaMovie, Mode: indexer.ModeRSS, Limit: 1}); err != nil {
		return plugin.TestResult{}, err
	}
	if title == "" {
		title = "Newznab indexer"
	}
	return plugin.TestResult{Message: title + " (" + strconv.Itoa(len(caps.Categories)) + " categories)"}, nil
}

func (*Client) ListOptions(_ context.Context, _ plugin.Connection, field string) ([]plugin.Option, error) {
	return nil, plugin.Errorf(plugin.CodeInvalid, "no live options for %q", field)
}

// ---- caps ----

type capsDoc struct {
	Server struct {
		Title string `xml:"title,attr"`
	} `xml:"server"`
	Limits struct {
		Max     int `xml:"max,attr"`
		Default int `xml:"default,attr"`
	} `xml:"limits"`
	Searching struct {
		Search      searchEl `xml:"search"`
		TVSearch    searchEl `xml:"tv-search"`
		MovieSearch searchEl `xml:"movie-search"`
	} `xml:"searching"`
	Categories []struct {
		ID     int    `xml:"id,attr"`
		Name   string `xml:"name,attr"`
		Subcat []struct {
			ID   int    `xml:"id,attr"`
			Name string `xml:"name,attr"`
		} `xml:"subcat"`
	} `xml:"categories>category"`
}

type searchEl struct {
	Available string `xml:"available,attr"`
	Params    string `xml:"supportedParams,attr"`
}

func (s searchEl) caps() indexer.SearchCaps {
	out := indexer.SearchCaps{Available: strings.EqualFold(s.Available, "yes"), Params: []string{}}
	for _, p := range strings.Split(s.Params, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out.Params = append(out.Params, p)
		}
	}
	return out
}

func (c *Client) Caps(ctx context.Context, conn plugin.Connection) (indexer.Caps, error) {
	caps, _, err := c.caps(ctx, conn)
	return caps, err
}

func (c *Client) caps(ctx context.Context, conn plugin.Connection) (indexer.Caps, string, error) {
	raw, err := c.api(ctx, conn, url.Values{"t": {"caps"}})
	if err != nil {
		return indexer.Caps{}, "", err
	}
	var d capsDoc
	if root(raw) != "caps" || xml.Unmarshal(raw, &d) != nil {
		return indexer.Caps{}, "", plugin.Errorf(plugin.CodeUnavailable, "the indexer answered something that is not Newznab caps (is the URL right?)")
	}
	out := indexer.Caps{
		PageSize: d.Limits.Default, MaxPageSize: d.Limits.Max,
		Text: d.Searching.Search.caps(), Movie: d.Searching.MovieSearch.caps(), TV: d.Searching.TVSearch.caps(),
		Categories: []indexer.Category{},
	}
	if out.MaxPageSize < out.PageSize {
		out.MaxPageSize = out.PageSize
	}
	for _, cat := range d.Categories {
		out.Categories = append(out.Categories, indexer.Category{ID: cat.ID, Name: cat.Name})
		for _, sub := range cat.Subcat {
			out.Categories = append(out.Categories, indexer.Category{ID: sub.ID, Name: cat.Name + "/" + sub.Name})
		}
	}
	return out, d.Server.Title, nil
}

// ---- search ----

func (c *Client) Search(ctx context.Context, conn plugin.Connection, q indexer.SearchQuery) (indexer.SearchResult, error) {
	params, err := searchParams(conn, q)
	if err != nil {
		return indexer.SearchResult{}, err
	}
	raw, err := c.api(ctx, conn, params)
	if err != nil {
		return indexer.SearchResult{}, err
	}
	return parseFeed(raw)
}

func searchParams(conn plugin.Connection, q indexer.SearchQuery) (url.Values, error) {
	var cfgKey, def, fn string
	switch q.Media {
	case indexer.MediaMovie:
		cfgKey, def, fn = "movie_categories", defaultMovieCategories, "movie"
	case indexer.MediaTV:
		cfgKey, def, fn = "tv_categories", defaultTVCategories, "tvsearch"
	default:
		return nil, plugin.Errorf(plugin.CodeInvalid, "unknown media %q", q.Media)
	}
	cats := q.Categories
	if len(cats) == 0 {
		raw := strings.TrimSpace(conn.String(cfgKey))
		if raw == "" {
			raw = def
		}
		var err error
		if cats, err = parseCategories(raw); err != nil {
			return nil, err
		}
	}
	ids := make([]string, len(cats))
	for i, id := range cats {
		ids[i] = strconv.Itoa(id)
	}

	v := url.Values{"cat": {strings.Join(ids, ",")}, "extended": {"1"}, "offset": {strconv.Itoa(max(q.Offset, 0))}}
	if q.Limit > 0 {
		v.Set("limit", strconv.Itoa(q.Limit))
	}
	switch q.Mode {
	case indexer.ModeText:
		if strings.TrimSpace(q.Text) == "" {
			return nil, plugin.Errorf(plugin.CodeInvalid, "a text search needs text")
		}
		v.Set("t", "search")
		v.Set("q", q.Text)
	case indexer.ModeRSS:
		v.Set("t", fn)
	case indexer.ModeIDs:
		v.Set("t", fn)
		if q.Text != "" {
			v.Set("q", q.Text)
		}
		if q.IMDBID != "" {
			v.Set("imdbid", strings.TrimPrefix(q.IMDBID, "tt"))
		}
		if q.TMDBID != 0 {
			v.Set("tmdbid", strconv.Itoa(q.TMDBID))
		}
		if q.TVDBID != 0 {
			v.Set("tvdbid", strconv.Itoa(q.TVDBID))
		}
		if q.Season != "" {
			season := q.Season
			if season == "0" {
				season = "00"
			}
			v.Set("season", season)
			if q.Episode != "" {
				v.Set("ep", q.Episode)
			}
		}
	default:
		return nil, plugin.Errorf(plugin.CodeInvalid, "unknown search mode %q", q.Mode)
	}
	return v, nil
}

func parseCategories(s string) ([]int, error) {
	var out []int
	for _, p := range strings.Split(s, ",") {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		n, err := strconv.Atoi(p)
		if err != nil || n <= 0 {
			return nil, plugin.Errorf(plugin.CodeInvalid, "category %q is not a number", p)
		}
		out = append(out, n)
	}
	if len(out) == 0 {
		return nil, plugin.Errorf(plugin.CodeInvalid, "no categories")
	}
	return out, nil
}

type feedDoc struct {
	Channel struct {
		Response struct {
			Offset int `xml:"offset,attr"`
			Total  int `xml:"total,attr"`
		} `xml:"response"`
		APILimits *struct {
			APICurrent  int `xml:"apicurrent,attr"`
			APIMax      int `xml:"apimax,attr"`
			GrabCurrent int `xml:"grabcurrent,attr"`
			GrabMax     int `xml:"grabmax,attr"`
		} `xml:"apilimits"`
		Items []itemEl `xml:"item"`
	} `xml:"channel"`
}

type itemEl struct {
	Title     string `xml:"title"`
	GUID      string `xml:"guid"`
	Link      string `xml:"link"`
	Comments  string `xml:"comments"`
	PubDate   string `xml:"pubDate"`
	Enclosure struct {
		URL    string `xml:"url,attr"`
		Length string `xml:"length,attr"`
	} `xml:"enclosure"`
	Attrs []struct {
		Name  string `xml:"name,attr"`
		Value string `xml:"value,attr"`
	} `xml:"attr"`
}

func parseFeed(raw []byte) (indexer.SearchResult, error) {
	var d feedDoc
	if root(raw) != "rss" || xml.Unmarshal(raw, &d) != nil {
		return indexer.SearchResult{}, plugin.Errorf(plugin.CodeUnavailable, "the indexer answered something that is not a Newznab feed (is the URL right?)")
	}
	res := indexer.SearchResult{
		Releases: make([]indexer.Release, 0, len(d.Channel.Items)),
		Offset:   d.Channel.Response.Offset, Total: d.Channel.Response.Total,
	}
	if l := d.Channel.APILimits; l != nil {
		res.Limits = indexer.Limits{Reported: true, APICurrent: l.APICurrent, APIMax: l.APIMax, GrabCurrent: l.GrabCurrent, GrabMax: l.GrabMax}
	}
	for _, it := range d.Channel.Items {
		res.Releases = append(res.Releases, it.release())
	}
	return res, nil
}

func (it itemEl) release() indexer.Release {
	attrs := map[string][]string{}
	for _, a := range it.Attrs {
		attrs[a.Name] = append(attrs[a.Name], strings.TrimSpace(a.Value))
	}
	first := func(name string) string {
		if v := attrs[name]; len(v) > 0 {
			return v[0]
		}
		return ""
	}
	num := func(s string) int { n, _ := strconv.Atoi(s); return n }

	r := indexer.Release{
		GUID:        strings.TrimSpace(it.GUID),
		Title:       strings.TrimSpace(it.Title),
		DownloadURL: strings.TrimSpace(it.Enclosure.URL),
		TMDBID:      num(first("tmdbid")),
		TVDBID:      num(first("tvdbid")),
		IMDBID:      imdb(first("imdb")),
		Season:      number(first("season")),
		Episode:     number(first("episode")),
		Grabs:       num(first("grabs")),
		Files:       num(first("files")),
		Password:    num(first("password")),
		Group:       first("group"),
		Scene:       first("prematch") == "1" || first("haspretime") == "1",
		Nuked:       first("nuked") == "1",
	}
	if r.GUID == "" {
		r.GUID = first("guid")
	}
	if r.DownloadURL == "" {
		r.DownloadURL = strings.TrimSpace(it.Link)
	}
	if info, _, _ := strings.Cut(strings.TrimSpace(it.Comments), "#"); info != "" {
		r.InfoURL = info
	} else if strings.HasPrefix(r.GUID, "http") {
		r.InfoURL = r.GUID
	}
	r.Size, _ = strconv.ParseInt(first("size"), 10, 64)
	if r.Size == 0 {
		r.Size, _ = strconv.ParseInt(strings.TrimSpace(it.Enclosure.Length), 10, 64)
	}
	if t, ok := parseDate(first("usenetdate")); ok {
		r.PublishDate = t
	} else if t, ok := parseDate(it.PubDate); ok {
		r.PublishDate = t
	}
	for _, c := range attrs["category"] {
		if n, err := strconv.Atoi(c); err == nil {
			r.Categories = append(r.Categories, n)
		}
	}
	for _, l := range attrs["language"] {
		for _, name := range strings.Split(l, ",") {
			if name = strings.TrimSpace(name); name != "" {
				r.Languages = append(r.Languages, name)
			}
		}
	}
	return r
}

// imdb returns "tt" and at least seven digits for an IMDb id given with or without "tt".
func imdb(s string) string {
	d := strings.TrimPrefix(strings.TrimSpace(s), "tt")
	if d == "" || strings.Trim(d, "0") == "" {
		return ""
	}
	for len(d) < 7 {
		d = "0" + d
	}
	return "tt" + d
}

// number strips an "S"/"E" prefix and leading zeros: "S01" is "1", "00" is "0".
// Anything that is not a plain number (a daily "03/15") is kept as is.
func number(s string) string {
	s = strings.TrimLeft(strings.TrimSpace(s), "SsEe")
	if s == "" {
		return ""
	}
	if _, err := strconv.Atoi(s); err != nil {
		return s
	}
	if s = strings.TrimLeft(s, "0"); s == "" {
		return "0"
	}
	return s
}

var dateLayouts = []string{time.RFC1123Z, time.RFC1123, "Mon, 2 Jan 2006 15:04:05 -0700", time.RFC822Z, time.RFC822}

func parseDate(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	for _, l := range dateLayouts {
		if t, err := time.Parse(l, s); err == nil {
			return t.UTC(), true
		}
	}
	return time.Time{}, false
}

// ---- fetch ----

func (c *Client) Fetch(ctx context.Context, conn plugin.Connection, downloadURL string) ([]byte, error) {
	u, err := url.Parse(downloadURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, plugin.Errorf(plugin.CodeInvalid, "the download URL must be an http(s) address")
	}
	// The release's own link already carries the credentials the indexer wants.
	status, header, raw, err := c.get(ctx, conn, downloadURL)
	if err != nil {
		return nil, err
	}
	switch status {
	case http.StatusNotFound, http.StatusGone:
		return nil, plugin.Errorf(plugin.CodeNotFound, "the indexer no longer has this release")
	case http.StatusTooManyRequests:
		return nil, &plugin.Error{Code: plugin.CodeRateLimited, Message: "the indexer's download limit is reached", RetryAfter: retryAfter(header), Limit: plugin.LimitGrab}
	}
	if perr := statusError(status); perr != nil {
		return nil, perr
	}
	switch root(raw) {
	case "nzb":
		return raw, nil
	case "error":
		perr := bodyError(raw, header)
		if perr.Code == plugin.CodeRateLimited {
			perr.Limit = plugin.LimitGrab
		}
		return nil, perr
	}
	return nil, plugin.Errorf(plugin.CodeUnavailable, "the indexer answered something that is not an NZB")
}

// ---- transport ----

// api calls the indexer's /api with params and returns the body of a non-error answer.
func (c *Client) api(ctx context.Context, conn plugin.Connection, params url.Values) ([]byte, error) {
	base, err := baseURL(conn)
	if err != nil {
		return nil, err
	}
	v := url.Values{}
	for k, vs := range params {
		v[k] = vs
	}
	v.Set("apikey", conn.String("api_key"))
	status, header, raw, err := c.get(ctx, conn, base+"?"+v.Encode())
	if err != nil {
		return nil, err
	}
	if status == http.StatusTooManyRequests && root(raw) != "error" {
		return nil, &plugin.Error{Code: plugin.CodeRateLimited, Message: "the indexer is rate limiting Kestrel", RetryAfter: retryAfter(header)}
	}
	if root(raw) == "error" {
		return nil, bodyError(raw, header)
	}
	if perr := statusError(status); perr != nil {
		return nil, perr
	}
	return raw, nil
}

func (c *Client) get(ctx context.Context, conn plugin.Connection, rawURL string) (int, http.Header, []byte, error) {
	key := conn.String("api_key")
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return 0, nil, nil, plugin.Errorf(plugin.CodeInvalid, "bad indexer URL")
	}
	res, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return 0, nil, nil, ctx.Err()
		}
		// url.Error embeds the request URL, which carries the API key: drop it.
		var ue *url.Error
		if errors.As(err, &ue) {
			err = ue.Err
		}
		return 0, nil, nil, plugin.Errorf(plugin.CodeUnavailable, "cannot reach the indexer: %s", redact(err.Error(), key))
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, maxBody))
	if err != nil {
		return 0, nil, nil, plugin.Errorf(plugin.CodeUnavailable, "reading the indexer's answer: %s", redact(err.Error(), key))
	}
	return res.StatusCode, res.Header, raw, nil
}

func statusError(status int) *plugin.Error {
	switch {
	case status == http.StatusOK:
		return nil
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return plugin.Errorf(plugin.CodeAuth, "the indexer rejected the API key")
	}
	return plugin.Errorf(plugin.CodeUnavailable, "the indexer answered HTTP %d", status)
}

// bodyError maps an <error code description/> answer. Codes 100-199 are account
// problems, 500 is the request budget, 501 the download budget.
func bodyError(raw []byte, header http.Header) *plugin.Error {
	var e struct {
		Code        int    `xml:"code,attr"`
		Description string `xml:"description,attr"`
	}
	_ = xml.Unmarshal(raw, &e)
	msg := strings.TrimSpace(e.Description)
	if msg == "" {
		msg = "error " + strconv.Itoa(e.Code)
	}
	switch {
	case e.Code >= 100 && e.Code < 200:
		return plugin.Errorf(plugin.CodeAuth, "the indexer rejected the API key: %s", msg)
	case e.Code == 500:
		return &plugin.Error{Code: plugin.CodeRateLimited, Message: msg, RetryAfter: retryAfter(header), Limit: plugin.LimitSearch}
	case e.Code == 501:
		return &plugin.Error{Code: plugin.CodeRateLimited, Message: msg, RetryAfter: retryAfter(header), Limit: plugin.LimitGrab}
	case e.Code >= 200 && e.Code < 300:
		return plugin.Errorf(plugin.CodeInvalid, "the indexer refused the request: %s", msg)
	case e.Code == 300:
		return plugin.Errorf(plugin.CodeNotFound, "%s", msg)
	}
	return plugin.Errorf(plugin.CodeUnavailable, "the indexer reported an error: %s", msg)
}

// retryAfter reads a Retry-After header: seconds or an HTTP date. 0 when absent.
func retryAfter(h http.Header) time.Duration {
	v := strings.TrimSpace(h.Get("Retry-After"))
	if v == "" {
		return 0
	}
	if n, err := strconv.Atoi(v); err == nil && n > 0 {
		return time.Duration(n) * time.Second
	}
	if t, err := http.ParseTime(v); err == nil {
		if d := time.Until(t); d > 0 {
			return d.Round(time.Second)
		}
	}
	return 0
}

// baseURL is the instance's URL with /api on the end exactly once.
func baseURL(conn plugin.Connection) (string, error) {
	raw := strings.TrimRight(strings.TrimSpace(conn.String("url")), "/")
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", plugin.Errorf(plugin.CodeInvalid, "URL must be an http(s) address")
	}
	if !strings.HasSuffix(u.Path, "/api") {
		raw += "/api"
	}
	return raw, nil
}

// root returns the local name of raw's root XML element, or "" when it is not XML.
func root(raw []byte) string {
	d := xml.NewDecoder(bytes.NewReader(raw))
	d.Strict = false
	d.CharsetReader = func(_ string, r io.Reader) (io.Reader, error) { return r, nil }
	for {
		tok, err := d.Token()
		if err != nil {
			return ""
		}
		if se, ok := tok.(xml.StartElement); ok {
			return se.Name.Local
		}
	}
}

func redact(s, key string) string {
	if key == "" {
		return s
	}
	return strings.ReplaceAll(s, key, "***")
}
