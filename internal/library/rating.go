package library

import (
	"database/sql"

	"github.com/hyprsh/kestrel/internal/library/db"
	"github.com/hyprsh/kestrel/internal/metadata"
)

// ratingColumns is how TMDB's audience rating is stored: NULL in both columns
// when nobody has voted.
func ratingColumns(r metadata.AudienceRating) (sql.NullFloat64, sql.NullInt64) {
	if !r.Rated() {
		return sql.NullFloat64{}, sql.NullInt64{}
	}
	return sql.NullFloat64{Float64: r.Average, Valid: true}, sql.NullInt64{Int64: int64(r.Votes), Valid: true}
}

// ratingOf reads a Title's stored audience rating; the zero AudienceRating
// when it has none.
func ratingOf(t db.Title) metadata.AudienceRating {
	if !t.TmdbVoteAverage.Valid || !t.TmdbVoteCount.Valid {
		return metadata.AudienceRating{}
	}
	return metadata.AudienceRating{Average: t.TmdbVoteAverage.Float64, Votes: int(t.TmdbVoteCount.Int64)}
}
