package metadata

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// tvdbTokenLife is how long a login token is reused. TheTVDB issues tokens
// valid for a month; renewing a few days early avoids racing the expiry, and a
// 401 triggers a fresh login in any case.
const tvdbTokenLife = 25 * 24 * time.Hour

// Episode is one aired-order episode from TheTVDB.
type Episode struct {
	ID     int
	Season int // 0 is Specials
	Number int
	Name   string     // the original title, from TheTVDB's default list
	Aired  *time.Time // the air date as a date at 00:00 UTC; nil when TheTVDB has none
	// PrimaryName is the title in the Primary Language; SeriesIn fills it, with
	// Name standing in where TheTVDB has no translation. It is empty when the
	// translated titles could not be fetched: an add then shows Name, and a
	// refresh keeps the stored title.
	PrimaryName string
	// Overview is TheTVDB's synopsis of the episode; "" when it has none.
	Overview string
}

// TVDBSeries is a Series on TheTVDB with every episode in aired order.
type TVDBSeries struct {
	ID       int
	Name     string
	Aliases  []string
	Episodes []Episode
	// OriginalLanguage is TheTVDB's ISO 639-2/T code ("eng"); "" when it has none.
	OriginalLanguage string
	Status           string // "continuing", "ended" or "upcoming" as TheTVDB says, lower-cased; "" when unknown
	// Network is the network TheTVDB lists for the Series; "" when it lists none.
	Network string
	// AirsTime is the time of day ("21:00") the Series airs at, in AirsTimezone;
	// "" when TheTVDB has none. AirsTimezone is the IANA zone of the Series'
	// network, worked out from the network's (else the Series') country; "" when
	// that is not one Kestrel knows, in which case AirsTime is no use.
	AirsTime     string
	AirsTimezone string
}

// TVDBProvider is what callers need of TheTVDB; *TVDB satisfies it and tests can swap it.
type TVDBProvider interface {
	// Series fetches a Series with all episodes of the official (aired) order.
	Series(ctx context.Context, id int) (TVDBSeries, error)
	// SeriesByIMDb resolves an IMDb id to a TheTVDB series id; ok is false when TheTVDB has none.
	SeriesByIMDb(ctx context.Context, imdbID string) (id int, ok bool, err error)
	// Updates lists the ids of the Series changed since a time.
	Updates(ctx context.Context, since time.Time) ([]int, error)
	// EpisodeNames fetches the official (aired) order's episode titles in a
	// language (ISO 639-1), keyed by TheTVDB episode id; untranslated episodes
	// are missing.
	EpisodeNames(ctx context.Context, id int, lang string) (map[int]string, error)
}

// TVDBOptions configures NewTVDB.
type TVDBOptions struct {
	// BaseURL defaults to https://api4.thetvdb.com/v4.
	BaseURL string
	// HTTP defaults to a client with a 20 s timeout.
	HTTP *http.Client
	Keys TVDBKeySource
	// Now is the clock for token expiry; defaults to time.Now.
	Now func() time.Time
}

// TVDB is the TheTVDB v4 client. It logs in with the API key, reuses the
// bearer token and logs in again when it is refused.
type TVDB struct {
	base string
	http *http.Client
	keys TVDBKeySource
	now  func() time.Time

	mu      sync.Mutex
	token   string
	expires time.Time
}

var _ TVDBProvider = (*TVDB)(nil)

// NewTVDB returns a client.
func NewTVDB(o TVDBOptions) *TVDB {
	if o.BaseURL == "" {
		o.BaseURL = "https://api4.thetvdb.com/v4"
	}
	if o.HTTP == nil {
		o.HTTP = &http.Client{Timeout: 20 * time.Second}
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	return &TVDB{base: strings.TrimRight(o.BaseURL, "/"), http: o.HTTP, keys: o.Keys, now: o.Now}
}

func (c *TVDB) login(ctx context.Context) (string, error) {
	key, err := c.keys.TVDB(ctx)
	if err != nil {
		return "", err
	}
	if key == "" {
		return "", &Error{Code: CodeAuth, Message: "no TheTVDB API key is configured"}
	}
	body, _ := json.Marshal(map[string]string{"apikey": key})
	var res struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if err := c.do(ctx, http.MethodPost, "/login", "", bytes.NewReader(body), &res); err != nil {
		return "", err
	}
	if res.Data.Token == "" {
		return "", &Error{Code: CodeUnavailable, Message: "TheTVDB sent no token"}
	}
	return res.Data.Token, nil
}

func (c *TVDB) bearer(ctx context.Context, renew bool) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !renew && c.token != "" && c.now().Before(c.expires) {
		return c.token, nil
	}
	tok, err := c.login(ctx)
	if err != nil {
		return "", err
	}
	c.token, c.expires = tok, c.now().Add(tvdbTokenLife)
	return tok, nil
}

// do sends one request. A non-empty token is sent as the bearer.
func (c *TVDB) do(ctx context.Context, method, path, token string, body io.Reader, into any) error {
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return &Error{Code: CodeUnavailable, Message: err.Error()}
	}
	defer res.Body.Close()
	switch {
	case res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden:
		return &Error{Code: CodeAuth, Message: "TheTVDB refused the API key or token"}
	case res.StatusCode == http.StatusNotFound:
		return &Error{Code: CodeNotFound, Message: "TheTVDB has no such record"}
	case res.StatusCode == http.StatusTooManyRequests:
		secs, _ := strconv.Atoi(res.Header.Get("Retry-After"))
		return &Error{Code: CodeRateLimited, RetryAfter: time.Duration(secs) * time.Second, Message: "TheTVDB rate limit reached"}
	case res.StatusCode != http.StatusOK:
		return &Error{Code: CodeUnavailable, Message: fmt.Sprintf("TheTVDB answered %d", res.StatusCode)}
	}
	if err := json.NewDecoder(res.Body).Decode(into); err != nil {
		return &Error{Code: CodeUnavailable, Message: "TheTVDB sent an unreadable answer: " + err.Error()}
	}
	return nil
}

// get is an authenticated GET; a refused token is replaced once.
func (c *TVDB) get(ctx context.Context, path string, into any) error {
	tok, err := c.bearer(ctx, false)
	if err != nil {
		return err
	}
	err = c.do(ctx, http.MethodGet, path, tok, nil, into)
	if e, ok := err.(*Error); ok && e.Code == CodeAuth {
		if tok, err = c.bearer(ctx, true); err != nil {
			return err
		}
		return c.do(ctx, http.MethodGet, path, tok, nil, into)
	}
	return err
}

// airDate reads TheTVDB's "2008-01-20" air date; nil for "", null or junk.
func airDate(s string) *time.Time {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return nil
	}
	return &t
}

// tvdbCompany is a network or other company on a TheTVDB record.
type tvdbCompany struct {
	Name    string `json:"name"`
	Country string `json:"country"`
}

// airsTime reads TheTVDB's "21:00" as "HH:MM"; ok is false for "" or anything else.
func airsTime(s string) (string, bool) {
	t, err := time.Parse("15:04", strings.TrimSpace(s))
	if err != nil {
		return "", false
	}
	return t.Format("15:04"), true
}

// networkZones are the IANA time zones of the countries whose networks the
// household is likely to follow, by the ISO 3166 codes TheTVDB uses (alpha-3,
// lower-case; alpha-2 is read too). A country with several zones is given its
// main broadcast one: a US network airs on Eastern time.
var networkZones = map[string]string{
	"usa": "America/New_York", "us": "America/New_York",
	"gbr": "Europe/London", "gb": "Europe/London", "uk": "Europe/London",
	"can": "America/Toronto", "ca": "America/Toronto",
	"aus": "Australia/Sydney", "au": "Australia/Sydney",
	"nzl": "Pacific/Auckland", "nz": "Pacific/Auckland",
	"irl": "Europe/Dublin", "ie": "Europe/Dublin",
	"deu": "Europe/Berlin", "de": "Europe/Berlin",
	"aut": "Europe/Vienna", "at": "Europe/Vienna",
	"che": "Europe/Zurich", "ch": "Europe/Zurich",
	"fra": "Europe/Paris", "fr": "Europe/Paris",
	"esp": "Europe/Madrid", "es": "Europe/Madrid",
	"ita": "Europe/Rome", "it": "Europe/Rome",
	"nld": "Europe/Amsterdam", "nl": "Europe/Amsterdam",
	"bel": "Europe/Brussels", "be": "Europe/Brussels",
	"swe": "Europe/Stockholm", "se": "Europe/Stockholm",
	"nor": "Europe/Oslo", "no": "Europe/Oslo",
	"dnk": "Europe/Copenhagen", "dk": "Europe/Copenhagen",
	"fin": "Europe/Helsinki", "fi": "Europe/Helsinki",
	"pol": "Europe/Warsaw", "pl": "Europe/Warsaw",
	"jpn": "Asia/Tokyo", "jp": "Asia/Tokyo",
	"kor": "Asia/Seoul", "kr": "Asia/Seoul",
}

// timezoneOfCountry is the IANA zone of a country's networks; "" when unknown.
func timezoneOfCountry(code string) string {
	return networkZones[strings.ToLower(strings.TrimSpace(code))]
}

// Series fetches the series with its aliases and every episode of the official
// (aired) order, following the pages.
func (c *TVDB) Series(ctx context.Context, id int) (TVDBSeries, error) {
	var head struct {
		Data struct {
			ID               int    `json:"id"`
			Name             string `json:"name"`
			OriginalLanguage string `json:"originalLanguage"`
			Aliases          []struct {
				Name string `json:"name"`
			} `json:"aliases"`
			Status *struct {
				Name string `json:"name"`
			} `json:"status"`
			AirsTime        string       `json:"airsTime"`
			OriginalCountry string       `json:"originalCountry"`
			OriginalNetwork *tvdbCompany `json:"originalNetwork"`
			LatestNetwork   *tvdbCompany `json:"latestNetwork"`
		} `json:"data"`
	}
	sid := strconv.Itoa(id)
	// The extended record is the base one plus the air time and the networks.
	if err := c.get(ctx, "/series/"+sid+"/extended?short=true", &head); err != nil {
		return TVDBSeries{}, err
	}
	out := TVDBSeries{ID: head.Data.ID, Name: head.Data.Name, OriginalLanguage: head.Data.OriginalLanguage}
	if head.Data.Status != nil {
		out.Status = strings.ToLower(head.Data.Status.Name)
	}
	network := head.Data.LatestNetwork
	if network == nil || network.Name == "" {
		network = head.Data.OriginalNetwork
	}
	country := head.Data.OriginalCountry
	if network != nil {
		out.Network = network.Name
		if network.Country != "" {
			country = network.Country
		}
	}
	if at, ok := airsTime(head.Data.AirsTime); ok {
		if zone := timezoneOfCountry(country); zone != "" {
			out.AirsTime, out.AirsTimezone = at, zone
		}
	}
	for _, a := range head.Data.Aliases {
		if a.Name != "" {
			out.Aliases = append(out.Aliases, a.Name)
		}
	}
	for page := 0; page < 200; page++ { // a hard stop against a provider that never ends its pages
		var res struct {
			Data struct {
				Episodes []struct {
					ID       int     `json:"id"`
					Name     string  `json:"name"`
					Aired    *string `json:"aired"`
					Number   int     `json:"number"`
					Season   int     `json:"seasonNumber"`
					Overview *string `json:"overview"`
				} `json:"episodes"`
			} `json:"data"`
			Links struct {
				Next *string `json:"next"`
			} `json:"links"`
		}
		q := url.Values{"page": {strconv.Itoa(page)}}
		if err := c.get(ctx, "/series/"+sid+"/episodes/official?"+q.Encode(), &res); err != nil {
			return TVDBSeries{}, err
		}
		for _, e := range res.Data.Episodes {
			ep := Episode{ID: e.ID, Season: e.Season, Number: e.Number, Name: e.Name}
			if e.Overview != nil {
				ep.Overview = strings.TrimSpace(*e.Overview)
			}
			if e.Aired != nil {
				ep.Aired = airDate(*e.Aired)
			}
			out.Episodes = append(out.Episodes, ep)
		}
		if res.Links.Next == nil || *res.Links.Next == "" {
			break
		}
	}
	return out, nil
}

// tvdbLanguages maps the Primary Languages (ISO 639-1) to TheTVDB's ISO 639-2/T codes.
var tvdbLanguages = map[string]string{"en": "eng", "de": "deu", "fr": "fra"}

// EpisodeNames pages through /series/{id}/episodes/official/{lang}, TheTVDB's
// episode list with names in one language. A language Kestrel cannot name to
// TheTVDB is an empty map.
func (c *TVDB) EpisodeNames(ctx context.Context, id int, lang string) (map[int]string, error) {
	out := map[int]string{}
	code, ok := tvdbLanguages[lang]
	if !ok {
		return out, nil
	}
	for page := 0; page < 200; page++ { // a hard stop against a provider that never ends its pages
		var res struct {
			Data struct {
				Episodes []struct {
					ID   int     `json:"id"`
					Name *string `json:"name"`
				} `json:"episodes"`
			} `json:"data"`
			Links struct {
				Next *string `json:"next"`
			} `json:"links"`
		}
		q := url.Values{"page": {strconv.Itoa(page)}}
		if err := c.get(ctx, "/series/"+strconv.Itoa(id)+"/episodes/official/"+code+"?"+q.Encode(), &res); err != nil {
			return nil, err
		}
		for _, e := range res.Data.Episodes {
			if e.Name != nil && *e.Name != "" {
				out[e.ID] = *e.Name
			}
		}
		if res.Links.Next == nil || *res.Links.Next == "" {
			break
		}
	}
	return out, nil
}

// SeriesIn fetches a Series with every episode's title in the Primary Language
// (ISO 639-1) as well. A Series already in that language asks for no
// translation, and a translation TheTVDB does not have (a 404 included) leaves
// the original title in its place. When the translations cannot be fetched at
// all, every PrimaryName stays empty and SeriesIn still succeeds.
func SeriesIn(ctx context.Context, p TVDBProvider, id int, lang string) (TVDBSeries, error) {
	s, err := p.Series(ctx, id)
	if err != nil {
		return s, err
	}
	var names map[int]string
	if code, ok := tvdbLanguages[lang]; ok && code != s.OriginalLanguage {
		names, err = p.EpisodeNames(ctx, id, lang)
		var e *Error
		if errors.As(err, &e) && e.Code == CodeNotFound {
			err = nil
		}
		if err != nil {
			// The titles in the Primary Language are a nicety: their failure
			// (which the provider reports to health) fails nothing else.
			return s, nil
		}
	}
	for i := range s.Episodes {
		e := &s.Episodes[i]
		if e.PrimaryName = names[e.ID]; e.PrimaryName == "" {
			e.PrimaryName = e.Name
		}
	}
	return s, nil
}

// SeriesByIMDb resolves an IMDb id to a TheTVDB series id.
func (c *TVDB) SeriesByIMDb(ctx context.Context, imdbID string) (int, bool, error) {
	var res struct {
		Data []struct {
			Series *struct {
				ID int `json:"id"`
			} `json:"series"`
		} `json:"data"`
	}
	if err := c.get(ctx, "/search/remoteid/"+url.PathEscape(imdbID), &res); err != nil {
		return 0, false, err
	}
	for _, d := range res.Data {
		if d.Series != nil && d.Series.ID != 0 {
			return d.Series.ID, true, nil
		}
	}
	return 0, false, nil
}

// Updates lists the ids of the Series TheTVDB changed since a time, following the pages.
func (c *TVDB) Updates(ctx context.Context, since time.Time) ([]int, error) {
	var ids []int
	seen := map[int]bool{}
	for page := 0; page < 200; page++ { // a hard stop against a provider that never ends its pages
		var res struct {
			Data []struct {
				RecordType string `json:"recordType"`
				RecordID   int    `json:"recordId"`
				SeriesID   int    `json:"seriesId"`
			} `json:"data"`
			Links struct {
				Next *string `json:"next"`
			} `json:"links"`
		}
		q := url.Values{"since": {strconv.FormatInt(since.Unix(), 10)}, "type": {"series"}, "action": {"update"}, "page": {strconv.Itoa(page)}}
		if err := c.get(ctx, "/updates?"+q.Encode(), &res); err != nil {
			return nil, err
		}
		for _, d := range res.Data {
			id := d.RecordID
			if d.RecordType != "series" && d.SeriesID != 0 {
				id = d.SeriesID
			}
			if id != 0 && !seen[id] {
				seen[id] = true
				ids = append(ids, id)
			}
		}
		if res.Links.Next == nil || *res.Links.Next == "" {
			break
		}
	}
	return ids, nil
}
