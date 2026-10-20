-- +goose Up
-- Owned by the library module: when a Release for a Movie was first seen (in
-- RSS or a search). A Movie with no release date anywhere counts as released
-- from then on. NULL until one is seen; never cleared.
ALTER TABLE titles ADD COLUMN release_seen_at TEXT;

-- +goose Down
ALTER TABLE titles DROP COLUMN release_seen_at;
