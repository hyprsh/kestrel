-- +goose Up
-- Owned by the library module: TMDB's audience rating of a Title (vote_average
-- out of 10, over vote_count votes), written when the Title is added and on
-- every metadata refresh. NULL until TMDB has a vote or the next refresh.
ALTER TABLE titles ADD COLUMN tmdb_vote_average REAL;
ALTER TABLE titles ADD COLUMN tmdb_vote_count INTEGER;

-- +goose Down
ALTER TABLE titles DROP COLUMN tmdb_vote_count;
ALTER TABLE titles DROP COLUMN tmdb_vote_average;
