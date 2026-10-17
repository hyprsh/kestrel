package metadata

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// ErrorCode is the stable class of a provider failure.
type ErrorCode string

const (
	CodeAuth        ErrorCode = "auth" // no key, or the provider refused it
	CodeNotFound    ErrorCode = "not_found"
	CodeRateLimited ErrorCode = "rate_limited"
	CodeUnavailable ErrorCode = "unavailable"
)

// Error is a failed provider call.
type Error struct {
	Code       ErrorCode
	RetryAfter time.Duration // for CodeRateLimited, when the provider said
	Message    string
}

func (e *Error) Error() string { return "metadata: " + string(e.Code) + ": " + e.Message }

// TMDBOptions configures NewTMDB.
type TMDBOptions struct {
	// BaseURL defaults to https://api.themoviedb.org/3.
	BaseURL string
	// ImageBase defaults to https://image.tmdb.org/t/p.
	ImageBase string
	// HTTP defaults to a client with a 20 s timeout.
	HTTP *http.Client
	Keys KeySource
}

// TMDB is the TMDB v3 client. It sends the key as `api_key`.
type TMDB struct {
	base   string
	images string
	http   *http.Client
	keys   KeySource
}

// NewTMDB returns a client.
func NewTMDB(o TMDBOptions) *TMDB {
	if o.BaseURL == "" {
		o.BaseURL = "https://api.themoviedb.org/3"
	}
	if o.ImageBase == "" {
		o.ImageBase = "https://image.tmdb.org/t/p"
	}
	if o.HTTP == nil {
		o.HTTP = &http.Client{Timeout: 20 * time.Second}
	}
	return &TMDB{base: strings.TrimRight(o.BaseURL, "/"), images: strings.TrimRight(o.ImageBase, "/"), http: o.HTTP, keys: o.Keys}
}

// Provider is what callers need of TMDB; *TMDB satisfies it and tests can swap it.
type Provider interface {
	Search(ctx context.Context, query string) ([]SearchResult, error)
	Movie(ctx context.Context, id int) (MovieDetails, error)
	// ImageURL is the URL of a poster at a TMDB size such as "w92".
	ImageURL(posterPath, size string) string
}

var _ Provider = (*TMDB)(nil)

// ImageURL is the URL of a TMDB image at a size such as "w92"; "" for no image.
func (c *TMDB) ImageURL(posterPath, size string) string {
	if posterPath == "" {
		return ""
	}
	return c.images + "/" + size + "/" + strings.TrimLeft(posterPath, "/")
}

func (c *TMDB) get(ctx context.Context, path string, q url.Values, into any) error {
	key, err := c.keys.TMDB(ctx)
	if err != nil {
		return err
	}
	if key == "" {
		return &Error{Code: CodeAuth, Message: "no TMDB API key is configured"}
	}
	q.Set("api_key", key)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path+"?"+q.Encode(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
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
		return &Error{Code: CodeAuth, Message: "TMDB refused the API key"}
	case res.StatusCode == http.StatusNotFound:
		return &Error{Code: CodeNotFound, Message: "TMDB has no such record"}
	case res.StatusCode == http.StatusTooManyRequests:
		secs, _ := strconv.Atoi(res.Header.Get("Retry-After"))
		return &Error{Code: CodeRateLimited, RetryAfter: time.Duration(secs) * time.Second, Message: "TMDB rate limit reached"}
	case res.StatusCode != http.StatusOK:
		return &Error{Code: CodeUnavailable, Message: fmt.Sprintf("TMDB answered %d", res.StatusCode)}
	}
	if err := json.NewDecoder(res.Body).Decode(into); err != nil {
		return &Error{Code: CodeUnavailable, Message: "TMDB sent an unreadable answer: " + err.Error()}
	}
	return nil
}

func year(date string) int {
	if len(date) < 4 {
		return 0
	}
	y, err := strconv.Atoi(date[:4])
	if err != nil {
		return 0
	}
	return y
}

// Search runs the add-search: one query across Movies and Series, in English.
// People and other result types are dropped.
func (c *TMDB) Search(ctx context.Context, query string) ([]SearchResult, error) {
	var res struct {
		Results []struct {
			MediaType     string `json:"media_type"`
			ID            int    `json:"id"`
			Title         string `json:"title"`
			Name          string `json:"name"`
			OriginalTitle string `json:"original_title"`
			OriginalName  string `json:"original_name"`
			Overview      string `json:"overview"`
			PosterPath    string `json:"poster_path"`
			ReleaseDate   string `json:"release_date"`
			FirstAirDate  string `json:"first_air_date"`
		} `json:"results"`
	}
	q := url.Values{"query": {query}, "language": {"en-US"}, "include_adult": {"false"}}
	if err := c.get(ctx, "/search/multi", q, &res); err != nil {
		return nil, err
	}
	out := make([]SearchResult, 0, len(res.Results))
	for _, r := range res.Results {
		switch r.MediaType {
		case "movie":
			out = append(out, SearchResult{Kind: Movie, TMDBID: r.ID, Title: r.Title, OriginalTitle: r.OriginalTitle,
				Year: year(r.ReleaseDate), PosterPath: r.PosterPath, Overview: r.Overview})
		case "tv":
			out = append(out, SearchResult{Kind: Series, TMDBID: r.ID, Title: r.Name, OriginalTitle: r.OriginalName,
				Year: year(r.FirstAirDate), PosterPath: r.PosterPath, Overview: r.Overview})
		}
	}
	return out, nil
}

// Movie fetches a Movie's details with its release dates, aliases,
// translations and external IDs in one call.
func (c *TMDB) Movie(ctx context.Context, id int) (MovieDetails, error) {
	var r struct {
		ID               int    `json:"id"`
		IMDbID           string `json:"imdb_id"`
		Title            string `json:"title"`
		OriginalTitle    string `json:"original_title"`
		OriginalLanguage string `json:"original_language"`
		ReleaseDate      string `json:"release_date"`
		Runtime          int    `json:"runtime"`
		Overview         string `json:"overview"`
		PosterPath       string `json:"poster_path"`
		ExternalIDs      struct {
			IMDbID string `json:"imdb_id"`
		} `json:"external_ids"`
		AlternativeTitles struct {
			Titles []struct {
				Country string `json:"iso_3166_1"`
				Title   string `json:"title"`
			} `json:"titles"`
		} `json:"alternative_titles"`
		Translations struct {
			Translations []struct {
				Country  string `json:"iso_3166_1"`
				Language string `json:"iso_639_1"`
				Data     struct {
					Title string `json:"title"`
				} `json:"data"`
			} `json:"translations"`
		} `json:"translations"`
		ReleaseDates struct {
			Results []struct {
				Country string `json:"iso_3166_1"`
				Dates   []struct {
					Certification string `json:"certification"`
					Date          string `json:"release_date"`
					Type          int    `json:"type"`
				} `json:"release_dates"`
			} `json:"results"`
		} `json:"release_dates"`
	}
	q := url.Values{
		"language":           {"en-US"},
		"append_to_response": {"release_dates,alternative_titles,translations,external_ids"},
	}
	if err := c.get(ctx, "/movie/"+strconv.Itoa(id), q, &r); err != nil {
		return MovieDetails{}, err
	}
	d := MovieDetails{
		TMDBID: r.ID, IMDbID: r.IMDbID, Title: r.Title, OriginalTitle: r.OriginalTitle,
		OriginalLanguage: r.OriginalLanguage, Year: year(r.ReleaseDate), Runtime: r.Runtime,
		Overview: r.Overview, PosterPath: r.PosterPath,
	}
	if d.IMDbID == "" {
		d.IMDbID = r.ExternalIDs.IMDbID
	}
	for _, a := range r.AlternativeTitles.Titles {
		d.Aliases = append(d.Aliases, Alias{Country: a.Country, Title: a.Title})
	}
	for _, t := range r.Translations.Translations {
		d.Translations = append(d.Translations, Translation{Language: t.Language, Country: t.Country, Title: t.Data.Title})
	}
	for _, country := range r.ReleaseDates.Results {
		for _, e := range country.Dates {
			at, err := time.Parse(time.RFC3339, e.Date)
			if err != nil || e.Type < int(Premiere) || e.Type > int(TV) {
				continue
			}
			d.ReleaseDates = append(d.ReleaseDates, ReleaseDate{
				Country: country.Country, Type: ReleaseType(e.Type), Date: at.UTC(), Certification: e.Certification,
			})
		}
	}
	return d, nil
}
