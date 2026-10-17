-- +goose Up
-- Owned by the profiles module. The eight builtin Profiles, seeded below; the
-- rows are never added to or removed, only their settings change. Nothing
-- branches on `key`. `trash_profile_*` name the TRaSH profile files (without
-- .json) that currently back the Profile for Movies and for Series; changing the
-- Primary Language re-points them. Seeded for an English household.
CREATE TABLE profiles (
    key                  TEXT    PRIMARY KEY,
    name                 TEXT    NOT NULL,
    sort                 INTEGER NOT NULL,
    slot                 TEXT    NOT NULL CHECK (slot IN ('sd', 'hd', 'uhd')),
    kids                 INTEGER NOT NULL CHECK (kids IN (0, 1)),
    language_rule        TEXT    NOT NULL CHECK (language_rule IN ('primary', 'original')),
    min_height           INTEGER NOT NULL,
    max_height           INTEGER NOT NULL,
    enabled              INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    original_fallback    INTEGER NOT NULL DEFAULT 0 CHECK (original_fallback IN (0, 1)),
    default_movies       INTEGER NOT NULL DEFAULT 0 CHECK (default_movies IN (0, 1)),
    default_series       INTEGER NOT NULL DEFAULT 0 CHECK (default_series IN (0, 1)),
    trash_profile_movies TEXT    NOT NULL,
    trash_profile_series TEXT    NOT NULL,
    CHECK (language_rule = 'primary' OR original_fallback = 0)
) STRICT;

-- At most one default per Slot and kind.
CREATE UNIQUE INDEX profiles_default_movies ON profiles (slot) WHERE default_movies = 1;
CREATE UNIQUE INDEX profiles_default_series ON profiles (slot) WHERE default_series = 1;

INSERT INTO profiles (key, name, sort, slot, kids, language_rule, min_height, max_height, default_movies, default_series, trash_profile_movies, trash_profile_series) VALUES
    ('sd-primary',    'SD',            1, 'sd',  0, 'primary',  0,    576,  0, 0, 'hd-bluray-web',  'web-1080p'),
    ('sd-original',   'SD Original',   2, 'sd',  0, 'original', 0,    576,  0, 0, 'hd-bluray-web',  'web-1080p'),
    ('hd-primary',    'HD',            3, 'hd',  0, 'primary',  720,  1080, 1, 1, 'hd-bluray-web',  'web-1080p'),
    ('hd-original',   'HD Original',   4, 'hd',  0, 'original', 720,  1080, 0, 0, 'hd-bluray-web',  'web-1080p'),
    ('kids-primary',  'Kids',          5, 'hd',  1, 'primary',  0,    1080, 0, 0, 'hd-bluray-web',  'web-1080p'),
    ('kids-original', 'Kids Original', 6, 'hd',  1, 'original', 0,    1080, 0, 0, 'hd-bluray-web',  'web-1080p'),
    ('uhd-primary',   'UHD',           7, 'uhd', 0, 'primary',  2160, 2160, 0, 0, 'uhd-bluray-web', 'web-2160p'),
    ('uhd-original',  'UHD Original',  8, 'uhd', 0, 'original', 2160, 2160, 0, 0, 'uhd-bluray-web', 'web-2160p');

-- +goose Down
DROP TABLE profiles;
