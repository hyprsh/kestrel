package api

import (
	"strconv"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/metadata"
)

// tmdbPage is a Title's page on TMDB's website.
func tmdbPage(kind oapi.TitleKind, tmdbID int) string {
	path := "movie"
	if kind == oapi.Series {
		path = "tv"
	}
	return "https://www.themoviedb.org/" + path + "/" + strconv.Itoa(tmdbID)
}

// ratingsOf is the `ratings` list of a Title: TMDB's audience rating when anyone has
// voted, else empty.
func ratingsOf(kind oapi.TitleKind, tmdbID int, r metadata.AudienceRating) []oapi.Rating {
	out := []oapi.Rating{}
	if !r.Rated() || tmdbID == 0 {
		return out
	}
	value, scale, votes, url := r.Average, 10.0, r.Votes, tmdbPage(kind, tmdbID)
	return append(out, oapi.Rating{Source: "tmdb", Value: &value, Scale: &scale, Votes: &votes, Url: &url})
}
