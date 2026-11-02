-- +goose NO TRANSACTION
-- +goose Up
-- Owned by the profiles module (ADR 0026): a Profile is a recipe, so it gains a Release Family (Bluray + WEB, Remux + WEB, WEB or SQP)
-- and its language rule may name a language ('en', 'de' or 'fr') beside 'primary' and 'original'. Every existing Profile
-- becomes Bluray + WEB with the language rule it has, which backs it with the same TRaSH profiles as before, so no Release scores differently.
-- Any stays Bluray + WEB: the CHECK says so.
--
-- SQLite cannot widen a CHECK in place, so the table is rebuilt the way SQLite documents (as 00048 did): foreign keys off, a
-- transaction of our own, a foreign key check before the commit.
PRAGMA foreign_keys = OFF;
BEGIN;

CREATE TABLE profiles_new (
    key                  TEXT    PRIMARY KEY,
    name                 TEXT    NOT NULL,
    sort                 INTEGER NOT NULL,
    any                  INTEGER NOT NULL CHECK (any IN (0, 1)),
    release_family       TEXT    NOT NULL DEFAULT 'bluray-web'
        CHECK (release_family IN ('bluray-web', 'remux-web', 'web', 'sqp') AND (any = 0 OR release_family = 'bluray-web')),
    language_rule        TEXT    NOT NULL CHECK (language_rule IN ('primary', 'original', 'en', 'de', 'fr')),
    min_height           INTEGER NOT NULL,
    max_height           INTEGER NOT NULL,
    enabled              INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    original_fallback    INTEGER NOT NULL DEFAULT 0 CHECK (original_fallback IN (0, 1)),
    trash_profile_movies TEXT    NOT NULL,
    trash_profile_series TEXT    NOT NULL,
    original_language    TEXT    NOT NULL DEFAULT 'reject'
        CHECK (original_language IN ('reject', 'offer', 'accept') AND (language_rule <> 'original' OR original_language = 'reject')),
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
    CHECK (language_rule <> 'original' OR original_fallback = 0),
    CHECK (min_height >= 0 AND max_height <= 2160 AND min_height <= max_height)
) STRICT;
INSERT INTO profiles_new (key, name, sort, any, release_family, language_rule, min_height, max_height, enabled, original_fallback,
    trash_profile_movies, trash_profile_series, original_language, custom, series_qualities, movie_qualities,
    series_cutoff, movie_cutoff, upgrade_until, min_score, movie_min_size, movie_max_size, episode_min_size, episode_max_size)
SELECT key, name, sort, any, 'bluray-web', language_rule, min_height, max_height, enabled, original_fallback,
    trash_profile_movies, trash_profile_series, original_language, custom, series_qualities, movie_qualities,
    series_cutoff, movie_cutoff, upgrade_until, min_score, movie_min_size, movie_max_size, episode_min_size, episode_max_size
FROM profiles;
DROP TABLE profiles;
ALTER TABLE profiles_new RENAME TO profiles;

PRAGMA foreign_key_check;
COMMIT;
PRAGMA foreign_keys = ON;

-- +goose Down
-- A Profile with a Release Family other than Bluray + WEB or a named language has no older form: it goes back to
-- Bluray + WEB, and a named language to the Primary-Language rule.
PRAGMA foreign_keys = OFF;
BEGIN;

CREATE TABLE profiles_old (
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
INSERT INTO profiles_old (key, name, sort, any, language_rule, min_height, max_height, enabled, original_fallback,
    trash_profile_movies, trash_profile_series, original_language, custom, series_qualities, movie_qualities,
    series_cutoff, movie_cutoff, upgrade_until, min_score, movie_min_size, movie_max_size, episode_min_size, episode_max_size)
SELECT key, name, sort, any, CASE WHEN language_rule = 'original' THEN 'original' ELSE 'primary' END, min_height, max_height, enabled, original_fallback,
    trash_profile_movies, trash_profile_series, original_language, custom, series_qualities, movie_qualities,
    series_cutoff, movie_cutoff, upgrade_until, min_score, movie_min_size, movie_max_size, episode_min_size, episode_max_size
FROM profiles;
DROP TABLE profiles;
ALTER TABLE profiles_old RENAME TO profiles;

PRAGMA foreign_key_check;
COMMIT;
PRAGMA foreign_keys = ON;
