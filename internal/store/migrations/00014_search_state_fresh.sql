-- +goose Up
-- Owned by the library module: a Version added in the UI or by a Request is
-- `fresh` until its first missing search, which runs at once (search on add).
-- A Version that arrives any other way (Adoption, a new season) is not: it joins
-- the rolling missing sweep and its 80 % budget stop.
ALTER TABLE search_state ADD COLUMN fresh INTEGER NOT NULL DEFAULT 0;
UPDATE search_state SET fresh = 1 WHERE last_missing_at IS NULL;

-- +goose Down
ALTER TABLE search_state DROP COLUMN fresh;
