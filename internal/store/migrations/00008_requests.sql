-- +goose Up
-- Owned by the requests module: Requests from outside Kestrel (Silo), accepted at
-- once and kept for good, rejected ones included. Who asked is stored as an id
-- and a display name; an email address never is. A Slot's status is derived from
-- its Version and Grabs, never stored.

CREATE TABLE requests (
    id                INTEGER PRIMARY KEY,
    source            TEXT    NOT NULL,
    source_request_id TEXT    NOT NULL,
    requester_id      TEXT    NOT NULL,
    requester_name    TEXT    NOT NULL,
    title_id          INTEGER REFERENCES titles (id) ON DELETE SET NULL,
    outcome           TEXT    NOT NULL CHECK (outcome IN ('accepted', 'rejected')),
    reject_reason     TEXT    CHECK (reject_reason IN ('not_on_tvdb', 'unknown_title', 'no_enabled_profile')),
    created_at        TEXT    NOT NULL,
    UNIQUE (source, source_request_id)
) STRICT;
CREATE INDEX requests_title ON requests (title_id);

CREATE TABLE request_slots (
    request_id  INTEGER NOT NULL REFERENCES requests (id) ON DELETE CASCADE,
    slot        TEXT    NOT NULL CHECK (slot IN ('standard', '4k')),
    profile_key TEXT,
    version_id  INTEGER REFERENCES versions (id) ON DELETE SET NULL,
    PRIMARY KEY (request_id, slot)
) STRICT;
CREATE INDEX request_slots_version ON request_slots (version_id);

-- The seasons a Series Request named; no rows means the whole Series.
CREATE TABLE request_seasons (
    request_id INTEGER NOT NULL REFERENCES requests (id) ON DELETE CASCADE,
    season     INTEGER NOT NULL,
    PRIMARY KEY (request_id, season)
) STRICT;

-- +goose Down
DROP TABLE request_seasons;
DROP TABLE request_slots;
DROP TABLE requests;
