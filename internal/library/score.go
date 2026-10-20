package library

import (
	"database/sql"

	"github.com/hyprsh/kestrel/internal/library/db"
	"github.com/hyprsh/kestrel/internal/metadata"
)

// scoreColumns is how a TMDB score is stored: NULL in both columns when
// nobody has voted.
func scoreColumns(sc metadata.Score) (sql.NullFloat64, sql.NullInt64) {
	if !sc.Rated() {
		return sql.NullFloat64{}, sql.NullInt64{}
	}
	return sql.NullFloat64{Float64: sc.Average, Valid: true}, sql.NullInt64{Int64: int64(sc.Votes), Valid: true}
}

// scoreOf reads a Title's stored TMDB score; the zero Score when it has none.
func scoreOf(t db.Title) metadata.Score {
	if !t.TmdbVoteAverage.Valid || !t.TmdbVoteCount.Valid {
		return metadata.Score{}
	}
	return metadata.Score{Average: t.TmdbVoteAverage.Float64, Votes: int(t.TmdbVoteCount.Int64)}
}
