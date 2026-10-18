-- +goose Up
-- Owned by the library module: Titles (Movies now, Series with their seasons and
-- episodes next), their Versions, files and search state. Deleting a Title
-- cascades to everything below it. Times are UTC RFC 3339 text.

CREATE TABLE titles (
    id                INTEGER PRIMARY KEY,
    kind              TEXT    NOT NULL CHECK (kind IN ('movie', 'series')),
    tmdb_id           INTEGER,
    tvdb_id           INTEGER,
    imdb_id           TEXT,
    title             TEXT    NOT NULL, -- English
    original_title    TEXT    NOT NULL,
    primary_title     TEXT    NOT NULL, -- in the Primary Language when added; the English title if TMDB has none
    year              INTEGER,
    original_language TEXT    NOT NULL DEFAULT '', -- ISO 639-1
    overview          TEXT    NOT NULL DEFAULT '',
    runtime           INTEGER,                     -- minutes
    poster_path       TEXT,                        -- TMDB path; the file is cached under <config>/cache/posters
    monitored         INTEGER NOT NULL DEFAULT 1 CHECK (monitored IN (0, 1)),
    series_monitor    TEXT    CHECK (series_monitor IN ('all', 'future', 'none')), -- NULL for Movies
    metadata_frozen   INTEGER NOT NULL DEFAULT 0 CHECK (metadata_frozen IN (0, 1)),
    root_folder       TEXT    NOT NULL,
    folder            TEXT,                        -- the Title's folder name, set by the first Import
    added_at          TEXT    NOT NULL,
    refreshed_at      TEXT    NOT NULL,
    CHECK (kind = 'series' OR series_monitor IS NULL),
    CHECK (tmdb_id IS NOT NULL OR tvdb_id IS NOT NULL)
) STRICT;

CREATE UNIQUE INDEX titles_tmdb ON titles (kind, tmdb_id) WHERE tmdb_id IS NOT NULL;
CREATE UNIQUE INDEX titles_tvdb ON titles (kind, tvdb_id) WHERE tvdb_id IS NOT NULL;

-- Alternative titles and translations, for matching Releases and files.
CREATE TABLE title_aliases (
    id       INTEGER PRIMARY KEY,
    title_id INTEGER NOT NULL REFERENCES titles (id) ON DELETE CASCADE,
    alias    TEXT    NOT NULL,
    country  TEXT    NOT NULL DEFAULT '', -- ISO 3166-1, for alternative titles
    language TEXT    NOT NULL DEFAULT ''  -- ISO 639-1, for translations
) STRICT;
CREATE INDEX title_aliases_title ON title_aliases (title_id);

-- Every release TMDB lists for a Movie: type 1 Premiere, 2 Theatrical (limited),
-- 3 Theatrical, 4 Digital, 5 Physical, 6 TV, with the country's certification.
CREATE TABLE title_release_dates (
    title_id      INTEGER NOT NULL REFERENCES titles (id) ON DELETE CASCADE,
    country       TEXT    NOT NULL,
    type          INTEGER NOT NULL CHECK (type BETWEEN 1 AND 6),
    date          TEXT    NOT NULL,
    certification TEXT    NOT NULL DEFAULT ''
) STRICT;
CREATE INDEX title_release_dates_title ON title_release_dates (title_id);

CREATE TABLE seasons (
    title_id  INTEGER NOT NULL REFERENCES titles (id) ON DELETE CASCADE,
    number    INTEGER NOT NULL,
    monitored INTEGER NOT NULL DEFAULT 1 CHECK (monitored IN (0, 1)),
    PRIMARY KEY (title_id, number)
) STRICT;

CREATE TABLE episodes (
    id        INTEGER PRIMARY KEY,
    title_id  INTEGER NOT NULL REFERENCES titles (id) ON DELETE CASCADE,
    season    INTEGER NOT NULL,
    number    INTEGER NOT NULL,
    tvdb_id   INTEGER,
    name      TEXT    NOT NULL DEFAULT '',
    air_date  TEXT,
    monitored INTEGER NOT NULL DEFAULT 1 CHECK (monitored IN (0, 1)),
    UNIQUE (title_id, season, number)
) STRICT;

-- One Version per Slot of a Title, under a Profile (named by key; the Profile
-- is chosen when the Version is added).
CREATE TABLE versions (
    id          INTEGER PRIMARY KEY,
    title_id    INTEGER NOT NULL REFERENCES titles (id) ON DELETE CASCADE,
    slot        TEXT    NOT NULL CHECK (slot IN ('standard', '4k')),
    profile_key TEXT    NOT NULL REFERENCES profiles (key),
    added_at    TEXT    NOT NULL,
    UNIQUE (title_id, slot)
) STRICT;

-- A Movie Version holds at most one file; a Series Version one per episode
-- (file_episodes). Imports fill these in.
CREATE TABLE files (
    id             INTEGER PRIMARY KEY,
    version_id     INTEGER NOT NULL REFERENCES versions (id) ON DELETE CASCADE,
    path           TEXT    NOT NULL,
    size           INTEGER NOT NULL,
    release_name   TEXT    NOT NULL,
    parsed_release TEXT,    -- JSON snapshot
    probe          TEXT,    -- JSON snapshot
    score          INTEGER,
    grab_id        INTEGER, -- the Grab that brought it, once grabs exist
    imported_at    TEXT    NOT NULL
) STRICT;
CREATE INDEX files_version ON files (version_id);

CREATE TABLE file_episodes (
    file_id    INTEGER NOT NULL REFERENCES files (id) ON DELETE CASCADE,
    episode_id INTEGER NOT NULL REFERENCES episodes (id) ON DELETE CASCADE,
    PRIMARY KEY (file_id, episode_id)
) STRICT;

-- When a Version is next searched for what is missing or for an Upgrade: one row
-- per Movie Version, and per (Series Version, season) with `season` set.
CREATE TABLE search_state (
    id              INTEGER PRIMARY KEY,
    version_id      INTEGER NOT NULL REFERENCES versions (id) ON DELETE CASCADE,
    season          INTEGER,
    next_missing_at TEXT,
    last_missing_at TEXT,
    next_upgrade_at TEXT,
    last_upgrade_at TEXT
) STRICT;
CREATE UNIQUE INDEX search_state_unit ON search_state (version_id, COALESCE(season, -1));

-- +goose Down
DROP TABLE search_state;
DROP TABLE file_episodes;
DROP TABLE files;
DROP TABLE versions;
DROP TABLE episodes;
DROP TABLE seasons;
DROP TABLE title_release_dates;
DROP TABLE title_aliases;
DROP TABLE titles;
