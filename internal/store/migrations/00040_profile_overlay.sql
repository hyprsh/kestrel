-- +goose Up
-- Owned by the profiles module: what a household sets on a Profile on top of the TRaSH
-- snapshot (ADR 0023). Every column is NULL until it is set, and NULL means "as TRaSH
-- has it" (for the cutoff and the sizes: no limit), so a Profile nobody edited behaves as
-- before. `custom` marks a Profile made with "New Profile…" (a copy of another); the six
-- builtin Profiles are never deleted, custom ones can be.
--   *_qualities  JSON [{"name": "WEBDL-1080p", "accepted": true}, ...], best first: the
--                order and the accepted qualities for that kind, replacing TRaSH's.
--   *_cutoff     the quality that is good enough ("Good enough at") for that kind.
--   upgrade_until  the Score at which a file stops being upgraded.
--   min_score    replaces the minimum Score of the backing TRaSH profile.
--   *_min_size, *_max_size  bytes: per Movie, and per episode of a Series.
ALTER TABLE profiles ADD COLUMN custom INTEGER NOT NULL DEFAULT 0 CHECK (custom IN (0, 1));
ALTER TABLE profiles ADD COLUMN series_qualities TEXT;
ALTER TABLE profiles ADD COLUMN movie_qualities TEXT;
ALTER TABLE profiles ADD COLUMN series_cutoff TEXT;
ALTER TABLE profiles ADD COLUMN movie_cutoff TEXT;
ALTER TABLE profiles ADD COLUMN upgrade_until INTEGER;
ALTER TABLE profiles ADD COLUMN min_score INTEGER;
ALTER TABLE profiles ADD COLUMN movie_min_size INTEGER;
ALTER TABLE profiles ADD COLUMN movie_max_size INTEGER;
ALTER TABLE profiles ADD COLUMN episode_min_size INTEGER;
ALTER TABLE profiles ADD COLUMN episode_max_size INTEGER;

-- +goose Down
ALTER TABLE profiles DROP COLUMN episode_max_size;
ALTER TABLE profiles DROP COLUMN episode_min_size;
ALTER TABLE profiles DROP COLUMN movie_max_size;
ALTER TABLE profiles DROP COLUMN movie_min_size;
ALTER TABLE profiles DROP COLUMN min_score;
ALTER TABLE profiles DROP COLUMN upgrade_until;
ALTER TABLE profiles DROP COLUMN movie_cutoff;
ALTER TABLE profiles DROP COLUMN series_cutoff;
ALTER TABLE profiles DROP COLUMN movie_qualities;
ALTER TABLE profiles DROP COLUMN series_qualities;
ALTER TABLE profiles DROP COLUMN custom;
