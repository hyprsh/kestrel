-- +goose Up
-- Owned by the profiles module. The six builtin Profiles, seeded below; the
-- rows are never added to or removed, only their settings change. Nothing
-- branches on `key`. `trash_profile_*` name the TRaSH profile files (without
-- .json) that currently back the Profile for Movies and for Series; changing the
-- Primary Language re-points them. Seeded for an English household.
CREATE TABLE profiles (
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
    CHECK (language_rule = 'primary' OR original_fallback = 0),
    CHECK ((slot = 'standard' AND min_height >= 0 AND max_height <= 1080 AND min_height <= max_height)
        OR (slot = '4k' AND min_height = 2160 AND max_height = 2160))
) STRICT;

-- At most one default per Slot and kind.
CREATE UNIQUE INDEX profiles_default_movies ON profiles (slot) WHERE default_movies = 1;
CREATE UNIQUE INDEX profiles_default_series ON profiles (slot) WHERE default_series = 1;

INSERT INTO profiles (key, name, sort, slot, any, language_rule, min_height, max_height, default_movies, default_series, trash_profile_movies, trash_profile_series) VALUES
    ('hd-primary',    'HD',            1, 'standard', 0, 'primary',  720,  1080, 1, 1, 'hd-bluray-web',  'web-1080p'),
    ('hd-original',   'HD Original',   2, 'standard', 0, 'original', 720,  1080, 0, 0, 'hd-bluray-web',  'web-1080p'),
    ('any-primary',   'Any',           3, 'standard', 1, 'primary',  0,    1080, 0, 0, 'hd-bluray-web',  'web-1080p'),
    ('any-original',  'Any Original',  4, 'standard', 1, 'original', 0,    1080, 0, 0, 'hd-bluray-web',  'web-1080p'),
    ('4k-primary',    '4K',            5, '4k',       0, 'primary',  2160, 2160, 0, 0, 'uhd-bluray-web', 'web-2160p'),
    ('4k-original',   '4K Original',   6, '4k',       0, 'original', 2160, 2160, 0, 0, 'uhd-bluray-web', 'web-2160p');

-- +goose Down
DROP TABLE profiles;
