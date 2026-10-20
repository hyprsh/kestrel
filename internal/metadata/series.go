package metadata

import (
	"context"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// SeriesDetails is everything Kestrel keeps about a Series from TMDB: add-search
// data, the TMDB-to-TheTVDB bridge and Series-level fallbacks. Seasons and
// episodes come from TheTVDB.
type SeriesDetails struct {
	TMDBID           int
	TVDBID           int // 0 when TMDB does not know the series' TheTVDB id
	IMDbID           string
	Title            string // English
	OriginalTitle    string
	OriginalLanguage string // ISO 639-1
	Year             int    // first air year; 0 when unknown
	Runtime          int    // minutes of a typical episode, 0 when unknown
	Overview         string
	PosterPath       string
	Score            Score // TMDB's audience score; not the content Ratings below
	// Ratings are the TV content ratings per country, as TV-typed ReleaseDates
	// dated by the first air date, so the release-date fallback applies.
	Ratings      ReleaseDates
	Aliases      []Alias
	Translations []Translation
	Genres       []string // TMDB's genre names, in its order
	Network      string   // the first network it aired on; "" when unknown
}

// TitleIn is the Series' title in a language (ISO 639-1), or "" when TMDB has
// no non-empty translation.
func (d SeriesDetails) TitleIn(language string) string {
	for _, t := range d.Translations {
		if strings.EqualFold(t.Language, language) && t.Title != "" {
			return t.Title
		}
	}
	return ""
}

// ExternalIDs are a TMDB series' ids elsewhere; zero or empty when unknown.
type ExternalIDs struct {
	TVDBID int
	IMDbID string
}

// Series fetches a Series' details with its external ids, aliases,
// translations and content ratings in one call.
func (c *TMDB) Series(ctx context.Context, id int) (SeriesDetails, error) {
	var r struct {
		ID               int    `json:"id"`
		Name             string `json:"name"`
		OriginalName     string `json:"original_name"`
		OriginalLanguage string `json:"original_language"`
		FirstAirDate     string `json:"first_air_date"`
		EpisodeRunTime   []int  `json:"episode_run_time"`
		Overview         string `json:"overview"`
		PosterPath       string `json:"poster_path"`
		Genres           genres `json:"genres"`
		Networks         []struct {
			Name string `json:"name"`
		} `json:"networks"`
		ExternalIDs struct {
			IMDbID string `json:"imdb_id"`
			TVDBID *int   `json:"tvdb_id"`
		} `json:"external_ids"`
		AlternativeTitles struct {
			Results []struct {
				Country string `json:"iso_3166_1"`
				Title   string `json:"title"`
			} `json:"results"`
		} `json:"alternative_titles"`
		Translations struct {
			Translations []struct {
				Country  string `json:"iso_3166_1"`
				Language string `json:"iso_639_1"`
				Data     struct {
					Name string `json:"name"`
				} `json:"data"`
			} `json:"translations"`
		} `json:"translations"`
		ContentRatings struct {
			Results []struct {
				Country string `json:"iso_3166_1"`
				Rating  string `json:"rating"`
			} `json:"results"`
		} `json:"content_ratings"`
		VoteAverage float64 `json:"vote_average"`
		VoteCount   int     `json:"vote_count"`
	}
	q := url.Values{
		"language":           {"en-US"},
		"append_to_response": {"external_ids,alternative_titles,translations,content_ratings"},
	}
	if err := c.get(ctx, "/tv/"+strconv.Itoa(id), q, &r); err != nil {
		return SeriesDetails{}, err
	}
	d := SeriesDetails{
		TMDBID: r.ID, IMDbID: r.ExternalIDs.IMDbID, Title: r.Name, OriginalTitle: r.OriginalName,
		OriginalLanguage: r.OriginalLanguage, Year: year(r.FirstAirDate), Overview: r.Overview, PosterPath: r.PosterPath,
		Score:  Score{Average: r.VoteAverage, Votes: r.VoteCount},
		Genres: r.Genres.names(),
	}
	if len(r.Networks) > 0 {
		d.Network = r.Networks[0].Name
	}
	if r.ExternalIDs.TVDBID != nil {
		d.TVDBID = *r.ExternalIDs.TVDBID
	}
	if len(r.EpisodeRunTime) > 0 {
		d.Runtime = r.EpisodeRunTime[0]
	}
	for _, a := range r.AlternativeTitles.Results {
		d.Aliases = append(d.Aliases, Alias{Country: a.Country, Title: a.Title})
	}
	for _, t := range r.Translations.Translations {
		d.Translations = append(d.Translations, Translation{Language: t.Language, Country: t.Country, Title: t.Data.Name})
	}
	var first time.Time
	if t, err := time.Parse("2006-01-02", r.FirstAirDate); err == nil {
		first = t
	}
	for _, cr := range r.ContentRatings.Results {
		if cr.Rating == "" {
			continue
		}
		d.Ratings = append(d.Ratings, ReleaseDate{Country: cr.Country, Type: TV, Date: first, Certification: cr.Rating})
	}
	return d, nil
}

// SeriesExternalIDs is the cheap bridge call: a series' TheTVDB and IMDb ids.
func (c *TMDB) SeriesExternalIDs(ctx context.Context, id int) (ExternalIDs, error) {
	var r struct {
		IMDbID string `json:"imdb_id"`
		TVDBID *int   `json:"tvdb_id"`
	}
	if err := c.get(ctx, "/tv/"+strconv.Itoa(id)+"/external_ids", url.Values{}, &r); err != nil {
		return ExternalIDs{}, err
	}
	out := ExternalIDs{IMDbID: r.IMDbID}
	if r.TVDBID != nil {
		out.TVDBID = *r.TVDBID
	}
	return out, nil
}
