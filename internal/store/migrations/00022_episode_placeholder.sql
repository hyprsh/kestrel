-- +goose Up
-- Owned by the library module: when Kestrel added the episode itself as a
-- Placeholder Episode, because a Release named it before TheTVDB listed it.
-- NULL for an episode TheTVDB lists; a refresh that adopts it clears it.
ALTER TABLE episodes ADD COLUMN placeholder_at TEXT;

-- +goose Down
ALTER TABLE episodes DROP COLUMN placeholder_at;
