-- +goose NO TRANSACTION
-- +goose Up
-- Owned by the profiles module (ADR 0024): a Profile no longer belongs to a Slot, so any Profile can fill any Slot. A
-- Profile's own min_height/max_height are its only resolution rule, and the defaults for new Titles live on the Slot
-- (`slots.default_movies/default_series`), not as flags on Profiles. So `slot`, `default_movies` and `default_series` go,
-- with the CHECK that tied the heights to the Slot and the two "one default per Slot" indexes.
--
-- A Slot without a default keeps the one Profile resolution gave it before: the flagged Profile of its old Slot, else the
-- enabled Primary-Language Profile of that Slot that is not Any, else the enabled Original-Language one. That is what makes
-- an existing library resolve the same defaults after the migration (4K had no flag but resolved to 4K).
--
-- Within one Title no two Versions use the same Profile. Profiles were bound to a Slot, so no library holds a duplicate.
--
-- SQLite cannot drop a column a CHECK mentions, so the table is rebuilt the way SQLite documents (as 00046 did): foreign
-- keys off, a transaction of our own, a foreign key check before the commit.
UPDATE slots SET default_movies = COALESCE(default_movies,
    (SELECT key FROM profiles p WHERE p.slot = slots.id AND p.default_movies = 1 AND p.enabled = 1),
    (SELECT key FROM profiles p WHERE p.slot = slots.id AND p.enabled = 1 AND p.any = 0 AND p.language_rule = 'primary' ORDER BY p.sort LIMIT 1),
    (SELECT key FROM profiles p WHERE p.slot = slots.id AND p.enabled = 1 AND p.any = 0 AND p.language_rule = 'original' ORDER BY p.sort LIMIT 1)),
  default_series = COALESCE(default_series,
    (SELECT key FROM profiles p WHERE p.slot = slots.id AND p.default_series = 1 AND p.enabled = 1),
    (SELECT key FROM profiles p WHERE p.slot = slots.id AND p.enabled = 1 AND p.any = 0 AND p.language_rule = 'primary' ORDER BY p.sort LIMIT 1),
    (SELECT key FROM profiles p WHERE p.slot = slots.id AND p.enabled = 1 AND p.any = 0 AND p.language_rule = 'original' ORDER BY p.sort LIMIT 1));

PRAGMA foreign_keys = OFF;
BEGIN;

CREATE TABLE profiles_new (
    key                  TEXT    PRIMARY KEY,
    name                 TEXT    NOT NULL,
    sort                 INTEGER NOT NULL,
    any                  INTEGER NOT NULL CHECK (any IN (0, 1)),
    language_rule        TEXT    NOT NULL CHECK (language_rule IN ('primary', 'original')),
    min_height           INTEGER NOT NULL,
    max_height           INTEGER NOT NULL,
    enabled              INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    original_fallback    INTEGER NOT NULL DEFAULT 0 CHECK (original_fallback IN (0, 1)),
    trash_profile_movies TEXT    NOT NULL,
    trash_profile_series TEXT    NOT NULL,
    original_language    TEXT    NOT NULL DEFAULT 'reject'
        CHECK (original_language IN ('reject', 'offer', 'accept') AND (language_rule = 'primary' OR original_language = 'reject')),
    custom               INTEGER NOT NULL DEFAULT 0 CHECK (custom IN (0, 1)),
    series_qualities     TEXT,
    movie_qualities      TEXT,
    series_cutoff        TEXT,
    movie_cutoff         TEXT,
    upgrade_until        INTEGER,
    min_score            INTEGER,
    movie_min_size       INTEGER,
    movie_max_size       INTEGER,
    episode_min_size     INTEGER,
    episode_max_size     INTEGER,
    CHECK (language_rule = 'primary' OR original_fallback = 0),
    CHECK (min_height >= 0 AND max_height <= 2160 AND min_height <= max_height)
) STRICT;
INSERT INTO profiles_new (key, name, sort, any, language_rule, min_height, max_height, enabled, original_fallback,
    trash_profile_movies, trash_profile_series, original_language, custom, series_qualities, movie_qualities,
    series_cutoff, movie_cutoff, upgrade_until, min_score, movie_min_size, movie_max_size, episode_min_size, episode_max_size)
SELECT key, name, sort, any, language_rule, min_height, max_height, enabled, original_fallback,
    trash_profile_movies, trash_profile_series, original_language, custom, series_qualities, movie_qualities,
    series_cutoff, movie_cutoff, upgrade_until, min_score, movie_min_size, movie_max_size, episode_min_size, episode_max_size
FROM profiles;
DROP TABLE profiles;
ALTER TABLE profiles_new RENAME TO profiles;

CREATE UNIQUE INDEX versions_title_profile ON versions (title_id, profile_key);

PRAGMA foreign_key_check;
COMMIT;
PRAGMA foreign_keys = ON;

-- +goose Down
PRAGMA foreign_keys = OFF;
BEGIN;
DROP INDEX versions_title_profile;

CREATE TABLE profiles_old (
    key                  TEXT    PRIMARY KEY,
    name                 TEXT    NOT NULL,
    sort                 INTEGER NOT NULL,
    slot                 TEXT    NOT NULL CHECK (slot IN ('standard', '4k')),
    any                  INTEGER NOT NULL CHECK (any IN (0, 1)),
    language_rule        TEXT    NOT NULL CHECK (language_rule IN ('primary', 'original')),
    min_height           INTEGER NOT NULL,
    max_height           INTEGER NOT NULL,
    enabled              INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    original_fallback    INTEGER NOT NULL DEFAULT 0 CHECK (original_fallback IN (0, 1)),
    default_movies       INTEGER NOT NULL DEFAULT 0 CHECK (default_movies IN (0, 1)),
    default_series       INTEGER NOT NULL DEFAULT 0 CHECK (default_series IN (0, 1)),
    trash_profile_movies TEXT    NOT NULL,
    trash_profile_series TEXT    NOT NULL,
    original_language    TEXT    NOT NULL DEFAULT 'reject'
        CHECK (original_language IN ('reject', 'offer', 'accept') AND (language_rule = 'primary' OR original_language = 'reject')),
    custom               INTEGER NOT NULL DEFAULT 0 CHECK (custom IN (0, 1)),
    series_qualities     TEXT,
    movie_qualities      TEXT,
    series_cutoff        TEXT,
    movie_cutoff         TEXT,
    upgrade_until        INTEGER,
    min_score            INTEGER,
    movie_min_size       INTEGER,
    movie_max_size       INTEGER,
    episode_min_size     INTEGER,
    episode_max_size     INTEGER,
    CHECK (language_rule = 'primary' OR original_fallback = 0),
    CHECK ((slot = 'standard' AND min_height >= 0 AND max_height <= 1080 AND min_height <= max_height)
        OR (slot = '4k' AND min_height = 2160 AND max_height = 2160))
) STRICT;
INSERT INTO profiles_old (key, name, sort, slot, any, language_rule, min_height, max_height, enabled, original_fallback,
    default_movies, default_series, trash_profile_movies, trash_profile_series, original_language, custom, series_qualities,
    movie_qualities, series_cutoff, movie_cutoff, upgrade_until, min_score, movie_min_size, movie_max_size, episode_min_size, episode_max_size)
SELECT key, name, sort, CASE WHEN min_height = 2160 THEN '4k' ELSE 'standard' END, any, language_rule, min_height, max_height, enabled, original_fallback,
    COALESCE((SELECT 1 FROM slots s WHERE s.default_movies = profiles.key LIMIT 1), 0),
    COALESCE((SELECT 1 FROM slots s WHERE s.default_series = profiles.key LIMIT 1), 0),
    trash_profile_movies, trash_profile_series, original_language, custom, series_qualities,
    movie_qualities, series_cutoff, movie_cutoff, upgrade_until, min_score, movie_min_size, movie_max_size, episode_min_size, episode_max_size
FROM profiles;
DROP TABLE profiles;
ALTER TABLE profiles_old RENAME TO profiles;
CREATE UNIQUE INDEX profiles_default_movies ON profiles (slot) WHERE default_movies = 1;
CREATE UNIQUE INDEX profiles_default_series ON profiles (slot) WHERE default_series = 1;
PRAGMA foreign_key_check;
COMMIT;
PRAGMA foreign_keys = ON;
