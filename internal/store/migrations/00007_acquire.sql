-- +goose Up
-- Owned by the acquire module: Grabs (a Release sent to the download client) and
-- the global Blocklist. Grabs outlive the Versions and Titles they were for, so
-- their references are set NULL on delete. The live download progress and the
-- candidate cache are in memory only.

CREATE TABLE grabs (
    id                 INTEGER PRIMARY KEY,
    title_id           INTEGER REFERENCES titles (id) ON DELETE SET NULL,
    version_id         INTEGER REFERENCES versions (id) ON DELETE SET NULL,
    release_guid       TEXT    NOT NULL,
    release_name       TEXT    NOT NULL,
    indexer_id         INTEGER NOT NULL, -- the indexer's plugin instance; no FK, the instance may be deleted
    indexer_name       TEXT    NOT NULL,
    protocol           TEXT    NOT NULL DEFAULT 'usenet',
    size               INTEGER NOT NULL,
    published_at       TEXT    NOT NULL,
    score              INTEGER NOT NULL,
    parsed             TEXT    NOT NULL, -- JSON snapshot of the parsed name
    verdict            TEXT    NOT NULL, -- JSON snapshot of the Verdict under the Version's Profile
    overridden         INTEGER NOT NULL DEFAULT 0 CHECK (overridden IN (0, 1)), -- grabbed despite rejections
    is_upgrade         INTEGER NOT NULL DEFAULT 0 CHECK (is_upgrade IN (0, 1)),
    client_instance_id INTEGER NOT NULL,
    client_id          TEXT    NOT NULL, -- the download client's id for the job (SABnzbd nzo_id)
    state              TEXT    NOT NULL CHECK (state IN ('sent', 'downloading', 'completed', 'importing', 'imported', 'failed')),
    failure            TEXT,
    stalled_reason     TEXT,
    stalled_since      TEXT,
    next_import_at     TEXT,
    created_at         TEXT    NOT NULL,
    updated_at         TEXT    NOT NULL
) STRICT;
CREATE INDEX grabs_version ON grabs (version_id);
CREATE INDEX grabs_state ON grabs (state);
CREATE UNIQUE INDEX grabs_client ON grabs (client_instance_id, client_id);

-- The episodes a Series Grab covers; empty for a Movie.
CREATE TABLE grab_episodes (
    grab_id    INTEGER NOT NULL REFERENCES grabs (id) ON DELETE CASCADE,
    episode_id INTEGER NOT NULL REFERENCES episodes (id) ON DELETE CASCADE,
    PRIMARY KEY (grab_id, episode_id)
) STRICT;

-- Releases never to grab again (global, never expire, removable).
CREATE TABLE blocklist (
    id           INTEGER PRIMARY KEY,
    release_name TEXT    NOT NULL,
    indexer_id   INTEGER NOT NULL,
    guid         TEXT    NOT NULL,
    published_at TEXT    NOT NULL,
    size         INTEGER NOT NULL,
    reason       TEXT    NOT NULL,
    title_id     INTEGER REFERENCES titles (id) ON DELETE SET NULL,
    grab_id      INTEGER REFERENCES grabs (id) ON DELETE SET NULL,
    created_at   TEXT    NOT NULL
) STRICT;
CREATE INDEX blocklist_name ON blocklist (release_name);
CREATE INDEX blocklist_guid ON blocklist (indexer_id, guid);

-- +goose Down
DROP TABLE blocklist;
DROP TABLE grab_episodes;
DROP TABLE grabs;
