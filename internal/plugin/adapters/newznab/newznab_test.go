package newznab_test

import (
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/adapters/newznab"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	"github.com/hyprsh/kestrel/internal/plugin/indexer/v1/conformance"
)

const key = "0123456789abcdef0123456789abcdef"

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func ctx() context.Context { return context.Background() }

// recorded serves one fixture per function (`t=`) and remembers every request.
type recorded struct {
	*httptest.Server
	mu    sync.Mutex
	calls []url.Values
}

// serve answers each Newznab function with the named fixture; a fixture name
// starting "status:" is "status:<code>:<fixture>[:<header>=<value>]".
func serve(t *testing.T, byFn map[string]string) *recorded {
	t.Helper()
	r := &recorded{}
	r.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		r.mu.Lock()
		r.calls = append(r.calls, req.URL.Query())
		r.mu.Unlock()
		name, ok := byFn[req.URL.Query().Get("t")]
		if req.URL.Path == "/nzb/release" {
			name, ok = byFn["get"], true
		}
		if !ok {
			http.NotFound(w, req)
			return
		}
		status := http.StatusOK
		if rest, found := strings.CutPrefix(name, "status:"); found {
			parts := strings.SplitN(rest, ":", 3)
			status, _ = strconv.Atoi(parts[0])
			name = parts[1]
			if len(parts) == 3 {
				h, v, _ := strings.Cut(parts[2], "=")
				w.Header().Set(h, v)
			}
		}
		w.WriteHeader(status)
		if name != "" {
			_, _ = w.Write(fixture(t, name))
		}
	}))
	t.Cleanup(r.Close)
	return r
}

func (r *recorded) conn(extra map[string]any) plugin.Connection {
	cfg := map[string]any{"url": r.URL, "api_key": key}
	for k, v := range extra {
		cfg[k] = v
	}
	return plugin.Connection{ID: 1, Config: cfg}
}

func (r *recorded) last() url.Values {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.calls[len(r.calls)-1]
}

func wantCode(t *testing.T, err error, want plugin.Code) *plugin.Error {
	t.Helper()
	var pe *plugin.Error
	if !errors.As(err, &pe) || pe.Code != want {
		t.Fatalf("want %s, got %v", want, err)
	}
	return pe
}

func TestManifestMatchesTheTicket(t *testing.T) {
	m := newznab.New(nil).Describe()
	if m.ID != "newznab" || m.Contract != "indexer.v1" {
		t.Fatalf("%+v", m)
	}
	want := map[string]struct {
		typ      plugin.FieldType
		def      any
		required bool
	}{
		"url": {plugin.FieldURL, nil, true}, "api_key": {plugin.FieldSecret, nil, true},
		"movie_categories": {plugin.FieldText, "2000", false}, "tv_categories": {plugin.FieldText, "5000", false},
		"api_requests_per_day": {plugin.FieldInt, nil, false}, "grabs_per_day": {plugin.FieldInt, nil, false},
	}
	if len(m.Fields) != len(want) {
		t.Fatalf("fields %+v", m.Fields)
	}
	for _, f := range m.Fields {
		w, ok := want[f.Key]
		if !ok || f.Type != w.typ || f.Default != w.def || f.Required != w.required {
			t.Errorf("field %+v", f)
		}
	}
}

func TestCapsReadsLimitsSearchesAndCategories(t *testing.T) {
	srv := serve(t, map[string]string{"caps": "caps.xml"})
	c, err := newznab.New(nil).Caps(ctx(), srv.conn(nil))
	if err != nil {
		t.Fatal(err)
	}
	want := indexer.Caps{
		PageSize: 50, MaxPageSize: 100,
		Text:  indexer.SearchCaps{Available: true, Params: []string{"q"}},
		Movie: indexer.SearchCaps{Available: true, Params: []string{"q", "imdbid", "tmdbid", "genre"}},
		TV:    indexer.SearchCaps{Available: true, Params: []string{"q", "rid", "tvdbid", "tvmazeid", "imdbid", "tmdbid", "season", "ep"}},
		Categories: []indexer.Category{
			{ID: 2000, Name: "Movies"}, {ID: 2030, Name: "Movies/SD"}, {ID: 2040, Name: "Movies/HD"}, {ID: 2045, Name: "Movies/UHD"},
			{ID: 5000, Name: "TV"}, {ID: 5040, Name: "TV/HD"}, {ID: 5045, Name: "TV/UHD"}, {ID: 102050, Name: "Custom Anime"},
		},
	}
	if !reflect.DeepEqual(c, want) {
		t.Errorf("caps\n got %+v\nwant %+v", c, want)
	}
	if q := srv.last(); q.Get("t") != "caps" || q.Get("apikey") != key {
		t.Errorf("request %v", q)
	}
}

func TestMovieSearchByIDsSendsTheRightRequestAndMapsTheFeed(t *testing.T) {
	srv := serve(t, map[string]string{"movie": "movie.xml"})
	res, err := newznab.New(nil).Search(ctx(), srv.conn(nil), indexer.SearchQuery{
		Media: indexer.MediaMovie, Mode: indexer.ModeIDs, IMDBID: "tt0133093", TMDBID: 603, Limit: 50, Offset: 100,
	})
	if err != nil {
		t.Fatal(err)
	}
	q := srv.last()
	for k, v := range map[string]string{
		"t": "movie", "imdbid": "0133093", "tmdbid": "603", "cat": "2000", "extended": "1", "offset": "100", "limit": "50", "apikey": key,
	} {
		if q.Get(k) != v {
			t.Errorf("%s = %q, want %q (%v)", k, q.Get(k), v, q)
		}
	}
	if q.Has("q") || q.Has("season") {
		t.Errorf("unset parameters were sent: %v", q)
	}

	if res.Total != 2 || res.Offset != 0 || len(res.Releases) != 2 {
		t.Fatalf("page %+v", res)
	}
	if want := (indexer.Limits{Reported: true, APICurrent: 12, APIMax: 100, GrabCurrent: 3, GrabMax: 50}); res.Limits != want {
		t.Errorf("limits %+v", res.Limits)
	}
	a := res.Releases[0]
	want := indexer.Release{
		GUID: "https://indexer.example/details/aaaa1111", Title: "The.Matrix.1999.2160p.UHD.BluRay.x265-GRP",
		DownloadURL: "https://indexer.example/getnzb/aaaa1111.nzb&i=1&r=SECRET", InfoURL: "https://indexer.example/details/aaaa1111",
		PublishDate: time.Date(2025, 7, 1, 22, 30, 0, 0, time.UTC), Size: 58000000000, Categories: []int{2000, 2045},
		IMDBID: "tt0133093", TMDBID: 603, Languages: []string{"English", "German", "French"},
		Grabs: 42, Scene: true, Files: 120, Group: "alt.binaries.movies",
	}
	if !reflect.DeepEqual(a, want) {
		t.Errorf("release\n got %+v\nwant %+v", a, want)
	}
	b := res.Releases[1]
	if !b.PublishDate.Equal(time.Date(2025, 6, 30, 9, 0, 0, 0, time.UTC)) {
		t.Errorf("without usenetdate the pubDate is used: %v", b.PublishDate)
	}
	if b.IMDBID != "tt0133093" || !b.Nuked || b.Scene || b.Password != 2 || b.Size != 9000000000 || len(b.Languages) != 0 {
		t.Errorf("second release %+v", b)
	}
}

func TestSeriesSearchSendsIDsSeasonAndEpisode(t *testing.T) {
	srv := serve(t, map[string]string{"tvsearch": "tvsearch.xml"})
	res, err := newznab.New(nil).Search(ctx(), srv.conn(nil), indexer.SearchQuery{
		Media: indexer.MediaTV, Mode: indexer.ModeIDs, TVDBID: 81189, Season: "1", Episode: "2",
	})
	if err != nil {
		t.Fatal(err)
	}
	q := srv.last()
	for k, v := range map[string]string{"t": "tvsearch", "tvdbid": "81189", "season": "1", "ep": "2", "cat": "5000", "extended": "1"} {
		if q.Get(k) != v {
			t.Errorf("%s = %q, want %q", k, q.Get(k), v)
		}
	}
	r := res.Releases[0]
	if r.TVDBID != 81189 || r.Season != "1" || r.Episode != "2" || r.IMDBID != "tt0903747" || r.GUID != "cccc3333" {
		t.Errorf("release %+v", r)
	}
	if res.Limits.Reported {
		t.Errorf("limits reported though the feed has none: %+v", res.Limits)
	}

	// A season pack is the same request without ep; specials (season 0) are "00".
	_, _ = newznab.New(nil).Search(ctx(), srv.conn(nil), indexer.SearchQuery{Media: indexer.MediaTV, Mode: indexer.ModeIDs, TVDBID: 81189, Season: "0"})
	if q := srv.last(); q.Get("season") != "00" || q.Has("ep") {
		t.Errorf("specials %v", q)
	}
	// A daily show's episode passes through.
	_, _ = newznab.New(nil).Search(ctx(), srv.conn(nil), indexer.SearchQuery{Media: indexer.MediaTV, Mode: indexer.ModeIDs, TVDBID: 1, Season: "2025", Episode: "03/15"})
	if q := srv.last(); q.Get("season") != "2025" || q.Get("ep") != "03/15" {
		t.Errorf("daily %v", q)
	}
}

func TestTextAndRSSSearches(t *testing.T) {
	srv := serve(t, map[string]string{"search": "movie.xml", "movie": "movie.xml", "tvsearch": "tvsearch.xml"})
	c := newznab.New(nil)

	if _, err := c.Search(ctx(), srv.conn(nil), indexer.SearchQuery{Media: indexer.MediaMovie, Mode: indexer.ModeText, Text: "The Matrix 1999"}); err != nil {
		t.Fatal(err)
	}
	if q := srv.last(); q.Get("t") != "search" || q.Get("q") != "The Matrix 1999" || q.Get("cat") != "2000" || q.Get("extended") != "1" {
		t.Errorf("text %v", q)
	}

	if _, err := c.Search(ctx(), srv.conn(nil), indexer.SearchQuery{Media: indexer.MediaTV, Mode: indexer.ModeRSS, Limit: 100}); err != nil {
		t.Fatal(err)
	}
	q := srv.last()
	if q.Get("t") != "tvsearch" || q.Get("cat") != "5000" || q.Get("limit") != "100" || q.Has("q") || q.Has("tvdbid") {
		t.Errorf("rss %v", q)
	}
}

func TestCategoriesComeFromTheQueryThenTheInstanceThenTheDefaults(t *testing.T) {
	srv := serve(t, map[string]string{"movie": "empty.xml"})
	c := newznab.New(nil)
	rss := indexer.SearchQuery{Media: indexer.MediaMovie, Mode: indexer.ModeRSS}

	_, _ = c.Search(ctx(), srv.conn(map[string]any{"movie_categories": "2040, 2045"}), rss)
	if got := srv.last().Get("cat"); got != "2040,2045" {
		t.Errorf("instance categories %q", got)
	}
	rss.Categories = []int{2030, 102050}
	_, _ = c.Search(ctx(), srv.conn(map[string]any{"movie_categories": "2040"}), rss)
	if got := srv.last().Get("cat"); got != "2030,102050" {
		t.Errorf("query categories %q", got)
	}
}

func TestBadSearchesAndConfigAreInvalid(t *testing.T) {
	srv := serve(t, map[string]string{"movie": "empty.xml"})
	c := newznab.New(nil)
	_, err := c.Search(ctx(), srv.conn(map[string]any{"movie_categories": "2000,movies"}), indexer.SearchQuery{Media: indexer.MediaMovie, Mode: indexer.ModeRSS})
	wantCode(t, err, plugin.CodeInvalid)
	_, err = c.Search(ctx(), srv.conn(nil), indexer.SearchQuery{Media: indexer.MediaMovie, Mode: "psychic"})
	wantCode(t, err, plugin.CodeInvalid)
	_, err = c.Search(ctx(), plugin.Connection{Config: map[string]any{"url": "indexer.example", "api_key": key}}, indexer.SearchQuery{Media: indexer.MediaMovie, Mode: indexer.ModeRSS})
	wantCode(t, err, plugin.CodeInvalid)
	if len(srv.calls) != 0 {
		t.Errorf("invalid searches reached the indexer: %v", srv.calls)
	}
}

func TestAPIPathIsNotDoubled(t *testing.T) {
	var path string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		_, _ = w.Write(fixture(t, "caps.xml"))
	}))
	defer srv.Close()
	for _, base := range []string{srv.URL, srv.URL + "/", srv.URL + "/api", srv.URL + "/prefix/"} {
		_, err := newznab.New(nil).Caps(ctx(), plugin.Connection{Config: map[string]any{"url": base, "api_key": key}})
		if err != nil {
			t.Fatal(err)
		}
		want := "/api"
		if strings.Contains(base, "prefix") {
			want = "/prefix/api"
		}
		if path != want {
			t.Errorf("%s requested %s, want %s", base, path, want)
		}
	}
}

func TestErrorMapping(t *testing.T) {
	rss := indexer.SearchQuery{Media: indexer.MediaMovie, Mode: indexer.ModeRSS}
	cases := []struct {
		name  string
		serve string
		code  plugin.Code
		limit string
		retry time.Duration
	}{
		{"credentials", "error_100.xml", plugin.CodeAuth, "", 0},
		{"unsupported function", "error_203.xml", plugin.CodeInvalid, "", 0},
		{"500 with HTTP 200", "error_500.xml", plugin.CodeRateLimited, plugin.LimitSearch, 0},
		{"500 with 429 and Retry-After", "status:429:error_500.xml:Retry-After=120", plugin.CodeRateLimited, plugin.LimitSearch, 120 * time.Second},
		{"501 with 429", "status:429:error_501.xml:Retry-After=30", plugin.CodeRateLimited, plugin.LimitGrab, 30 * time.Second},
		{"bare 429", "status:429:", plugin.CodeRateLimited, "", 0},
		{"bare 429 with a date", "status:429::Retry-After=" + time.Now().Add(time.Hour).UTC().Format(http.TimeFormat), plugin.CodeRateLimited, "", time.Hour},
		{"401", "status:401:", plugin.CodeAuth, "", 0},
		{"503", "status:503:", plugin.CodeUnavailable, "", 0},
		{"not newznab", "release.nzb", plugin.CodeUnavailable, "", 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := serve(t, map[string]string{"movie": tc.serve})
			_, err := newznab.New(nil).Search(ctx(), srv.conn(nil), rss)
			pe := wantCode(t, err, tc.code)
			if pe.Limit != tc.limit {
				t.Errorf("limit %q, want %q", pe.Limit, tc.limit)
			}
			if d := pe.RetryAfter - tc.retry; d < -2*time.Second || d > 2*time.Second {
				t.Errorf("retry after %v, want %v", pe.RetryAfter, tc.retry)
			}
			if strings.Contains(err.Error(), key) {
				t.Errorf("error leaks the API key: %v", err)
			}
		})
	}
}

func TestErrorsNeverLeakTheKey(t *testing.T) {
	dead := httptest.NewServer(http.NotFoundHandler())
	dead.Close()
	_, err := newznab.New(nil).Search(ctx(), plugin.Connection{Config: map[string]any{"url": dead.URL, "api_key": key}}, indexer.SearchQuery{Media: indexer.MediaMovie, Mode: indexer.ModeRSS})
	wantCode(t, err, plugin.CodeUnavailable)
	if strings.Contains(err.Error(), key) {
		t.Errorf("leak: %v", err)
	}
}

func TestTestProvesTheKeyWithASearchNotJustCaps(t *testing.T) {
	// Many indexers serve caps to anyone: the key is only proven by a search.
	srv := serve(t, map[string]string{"caps": "caps.xml", "movie": "error_100.xml"})
	_, err := newznab.New(nil).Test(ctx(), srv.conn(nil))
	wantCode(t, err, plugin.CodeAuth)

	srv = serve(t, map[string]string{"caps": "caps.xml", "movie": "empty.xml"})
	res, err := newznab.New(nil).Test(ctx(), srv.conn(nil))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(res.Message, "NZBgeek-like") {
		t.Errorf("message %q does not name the indexer", res.Message)
	}
	if q := srv.last(); q.Get("limit") != "1" || q.Get("cat") != "2000" {
		t.Errorf("test search %v", q)
	}
}

func TestFetch(t *testing.T) {
	srv := serve(t, map[string]string{"get": "release.nzb"})
	got, err := newznab.New(nil).Fetch(ctx(), srv.conn(nil), srv.URL+"/nzb/release?r=SECRET")
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(fixture(t, "release.nzb")) {
		t.Errorf("body %q", got)
	}

	for _, tc := range []struct {
		name, serve string
		code        plugin.Code
		limit       string
	}{
		{"404 is gone", "status:404:", plugin.CodeNotFound, ""},
		{"410 is gone", "status:410:", plugin.CodeNotFound, ""},
		{"429 is the grab budget", "status:429::Retry-After=60", plugin.CodeRateLimited, plugin.LimitGrab},
		{"501 body at 200", "error_501.xml", plugin.CodeRateLimited, plugin.LimitGrab},
		{"credentials", "error_100.xml", plugin.CodeAuth, ""},
		{"no such item", "status:200:error_203.xml", plugin.CodeInvalid, ""},
		{"500", "status:500:", plugin.CodeUnavailable, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := serve(t, map[string]string{"get": tc.serve})
			_, err := newznab.New(nil).Fetch(ctx(), srv.conn(nil), srv.URL+"/nzb/release")
			if pe := wantCode(t, err, tc.code); pe.Limit != tc.limit {
				t.Errorf("limit %q", pe.Limit)
			}
		})
	}

	t.Run("something that is not an NZB", func(t *testing.T) {
		srv := serve(t, map[string]string{"get": "caps.xml"})
		_, err := newznab.New(nil).Fetch(ctx(), srv.conn(nil), srv.URL+"/nzb/release")
		wantCode(t, err, plugin.CodeUnavailable)
	})
	t.Run("a non-http URL", func(t *testing.T) {
		_, err := newznab.New(nil).Fetch(ctx(), plugin.Connection{Config: map[string]any{"url": "http://x", "api_key": key}}, "file:///etc/passwd")
		wantCode(t, err, plugin.CodeInvalid)
	})
}

func TestHonoursContextCancellation(t *testing.T) {
	srv := serve(t, map[string]string{"movie": "movie.xml"})
	c, cancel := context.WithCancel(ctx())
	cancel()
	_, err := newznab.New(nil).Search(c, srv.conn(nil), indexer.SearchQuery{Media: indexer.MediaMovie, Mode: indexer.ModeRSS})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v", err)
	}
}

// ---- conformance ----

// statefulNewznab is a Newznab indexer that keeps the releases published to it.
type statefulNewznab struct {
	key string

	mu       sync.Mutex
	seq      int
	releases []stored
	limits   map[string]time.Duration
	base     string
}

type stored struct {
	indexer.Release
	id  int
	nzb []byte
}

func newStateful(key string) *statefulNewznab {
	return &statefulNewznab{key: key, limits: map[string]time.Duration{}}
}

func (s *statefulNewznab) Publish(r indexer.Release, nzb []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.seq++
	s.drop(r.Title)
	s.releases = append(s.releases, stored{Release: r, id: s.seq, nzb: nzb})
	return nil
}

func (s *statefulNewznab) Remove(title string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.drop(title)
}

func (s *statefulNewznab) drop(title string) {
	s.releases = slices.DeleteFunc(s.releases, func(r stored) bool { return r.Title == title })
}

func (s *statefulNewznab) Exhaust(limit string, retryAfter time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.limits[limit] = retryAfter
}

func (s *statefulNewznab) Replenish() {
	s.mu.Lock()
	defer s.mu.Unlock()
	clear(s.limits)
}

func (s *statefulNewznab) limited(w http.ResponseWriter, limit string, wait time.Duration, code int, desc string) bool {
	if _, spent := s.limits[limit]; !spent {
		return false
	}
	if wait > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(int(wait.Seconds())))
	}
	w.WriteHeader(http.StatusTooManyRequests)
	fmt.Fprintf(w, `<?xml version="1.0"?><error code="%d" description="%s"/>`, code, desc)
	return true
}

func (s *statefulNewznab) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	q := r.URL.Query()
	if strings.HasPrefix(r.URL.Path, "/getnzb/") {
		if q.Get("r") != s.key {
			fmt.Fprint(w, `<?xml version="1.0"?><error code="100" description="Incorrect user credentials"/>`)
			return
		}
		if s.limited(w, plugin.LimitGrab, s.limits[plugin.LimitGrab], 501, "Download limit reached (1/1)") {
			return
		}
		id, _ := strconv.Atoi(strings.TrimPrefix(r.URL.Path, "/getnzb/"))
		for _, st := range s.releases {
			if st.id == id {
				_, _ = w.Write(st.nzb)
				return
			}
		}
		http.NotFound(w, r)
		return
	}
	if r.URL.Path != "/api" {
		http.NotFound(w, r)
		return
	}
	if q.Get("t") == "caps" {
		_, _ = w.Write(fixture2("caps.xml"))
		return
	}
	if q.Get("apikey") != s.key {
		fmt.Fprint(w, `<?xml version="1.0"?><error code="100" description="Incorrect user credentials"/>`)
		return
	}
	if s.limited(w, plugin.LimitSearch, s.limits[plugin.LimitSearch], 500, "Request limit reached (1/1)") {
		return
	}

	var cats []int
	for _, c := range strings.Split(q.Get("cat"), ",") {
		n, _ := strconv.Atoi(c)
		cats = append(cats, n)
	}
	var hits []stored
	for _, st := range s.releases {
		if !catMatch(st.Categories, cats) || !s.matches(st, q) {
			continue
		}
		hits = append(hits, st)
	}
	sort.SliceStable(hits, func(i, j int) bool { return hits[i].PublishDate.After(hits[j].PublishDate) })
	total := len(hits)
	off, _ := strconv.Atoi(q.Get("offset"))
	if off > len(hits) {
		off = len(hits)
	}
	hits = hits[off:]
	if lim, _ := strconv.Atoi(q.Get("limit")); lim > 0 && len(hits) > lim {
		hits = hits[:lim]
	}

	var b strings.Builder
	fmt.Fprintf(&b, `<?xml version="1.0"?><rss version="2.0" xmlns:newznab="http://www.newznab.com/DTD/2010/feeds/attributes/"><channel><title>stateful</title><newznab:response offset="%d" total="%d"/>`, off, total)
	for _, st := range hits {
		dl := fmt.Sprintf("%s/getnzb/%d?r=%s", s.base, st.id, s.key)
		fmt.Fprintf(&b, `<item><title>%s</title><guid isPermaLink="false">guid-%d</guid><link>%s</link><pubDate>%s</pubDate><enclosure url="%s" length="%d" type="application/x-nzb"/>`,
			xmlEscape(st.Title), st.id, dl, st.PublishDate.Format(time.RFC1123Z), dl, st.Size)
		attr := func(n, v string) { fmt.Fprintf(&b, `<newznab:attr name="%s" value="%s"/>`, n, xmlEscape(v)) }
		attr("size", strconv.FormatInt(st.Size, 10))
		attr("usenetdate", st.PublishDate.Format(time.RFC1123Z))
		for _, c := range st.Categories {
			attr("category", strconv.Itoa(c))
		}
		if st.IMDBID != "" {
			attr("imdb", strings.TrimPrefix(st.IMDBID, "tt"))
		}
		if st.TMDBID != 0 {
			attr("tmdbid", strconv.Itoa(st.TMDBID))
		}
		if st.TVDBID != 0 {
			attr("tvdbid", strconv.Itoa(st.TVDBID))
		}
		if st.Season != "" {
			n, _ := strconv.Atoi(st.Season)
			attr("season", fmt.Sprintf("S%02d", n))
		}
		if st.Episode != "" {
			n, _ := strconv.Atoi(st.Episode)
			attr("episode", fmt.Sprintf("E%02d", n))
		}
		if len(st.Languages) > 0 {
			attr("language", strings.Join(st.Languages, ", "))
		}
		if st.Grabs != 0 {
			attr("grabs", strconv.Itoa(st.Grabs))
		}
		if st.Scene {
			attr("prematch", "1")
		}
		if st.Group != "" {
			attr("group", st.Group)
		}
		b.WriteString(`</item>`)
	}
	b.WriteString(`</channel></rss>`)
	_, _ = w.Write([]byte(b.String()))
}

func xmlEscape(s string) string {
	var b strings.Builder
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}

func fixture2(name string) []byte {
	b, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		panic(err)
	}
	return b
}

func catMatch(have, want []int) bool {
	for _, h := range have {
		for _, w := range want {
			if h == w || (w%1000 == 0 && h/1000 == w/1000) {
				return true
			}
		}
	}
	return false
}

func (s *statefulNewznab) matches(st stored, q url.Values) bool {
	switch q.Get("t") {
	case "search":
		have := strings.FieldsFunc(strings.ToLower(st.Title), func(r rune) bool { return !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9') })
		for _, w := range strings.Fields(strings.ToLower(q.Get("q"))) {
			if !slices.Contains(have, w) {
				return false
			}
		}
		return true
	case "movie", "tvsearch":
	default:
		return false
	}
	if v := q.Get("imdbid"); v != "" && strings.TrimPrefix(st.IMDBID, "tt") != v {
		return false
	}
	if v := q.Get("tmdbid"); v != "" && strconv.Itoa(st.TMDBID) != v {
		return false
	}
	if v := q.Get("tvdbid"); v != "" && strconv.Itoa(st.TVDBID) != v {
		return false
	}
	num := func(s string) int { n, _ := strconv.Atoi(s); return n }
	if v := q.Get("season"); v != "" && (st.Season == "" || num(st.Season) != num(v)) {
		return false
	}
	if v := q.Get("ep"); v != "" && (st.Episode == "" || num(st.Episode) != num(v)) {
		return false
	}
	return true
}

func TestNewznabPassesTheConformanceSuite(t *testing.T) {
	st := newStateful(key)
	srv := httptest.NewServer(st)
	defer srv.Close()
	st.base = srv.URL
	dead := httptest.NewServer(http.NotFoundHandler())
	dead.Close()

	cfg := func(url, k string) plugin.Connection {
		return plugin.Connection{ID: 1, Config: map[string]any{"url": url, "api_key": k, "movie_categories": "2000", "tv_categories": "5000"}}
	}
	conformance.Run(t, conformance.Subject{
		Indexer:     newznab.New(nil),
		Conn:        cfg(srv.URL, key),
		BadAuth:     cfg(srv.URL, "wrong"),
		Unreachable: cfg(dead.URL, key),
		Backend:     st,
	})
}
