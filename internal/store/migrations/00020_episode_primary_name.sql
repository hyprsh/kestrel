-- +goose Up
-- Owned by the library module: an episode's title in the Primary Language,
-- from TheTVDB's translation, next to `name`, the original title. '' until the
-- next metadata refresh fetches it; readers fall back to `name`.
ALTER TABLE episodes ADD COLUMN primary_name TEXT NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE episodes DROP COLUMN primary_name;
