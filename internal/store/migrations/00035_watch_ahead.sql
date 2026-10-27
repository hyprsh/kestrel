-- +goose Up
-- Watch-ahead (ADR 0019). `request_watch_ahead` is owned by the requests
-- module: a row marks a Request that asked for its Series one season at a time.
-- The rest is owned by watchahead:
--   `plex_history_position` is how far into each Plex instance's play history
--     it has read: the `viewedAt` (Unix seconds) of the newest play stored.
--   `watch_ahead_plays` holds each distinct episode played by any account on the
--     Plex server, by the Series' TheTVDB id, so that a play seen before the
--     Series is a Title still counts.
--   `plex_shows` maps a Plex show (its metadata key) to the Series' TheTVDB id,
--     fetched once; `tvdb_id` 0 means the show has no TheTVDB guid.
CREATE TABLE request_watch_ahead (
    request_id INTEGER PRIMARY KEY REFERENCES requests (id) ON DELETE CASCADE
) STRICT;

CREATE TABLE plex_history_position (
    instance_id INTEGER PRIMARY KEY REFERENCES plugin_instances (id) ON DELETE CASCADE,
    viewed_at   INTEGER NOT NULL
) STRICT;

CREATE TABLE watch_ahead_plays (
    tvdb_id       INTEGER NOT NULL,
    season        INTEGER NOT NULL,
    episode       INTEGER NOT NULL,
    first_seen_at TEXT    NOT NULL,
    PRIMARY KEY (tvdb_id, season, episode)
) STRICT;

CREATE TABLE plex_shows (
    instance_id INTEGER NOT NULL REFERENCES plugin_instances (id) ON DELETE CASCADE,
    show_key    TEXT    NOT NULL,
    tvdb_id     INTEGER NOT NULL,
    resolved_at TEXT    NOT NULL,
    PRIMARY KEY (instance_id, show_key)
) STRICT;

-- +goose Down
DROP TABLE plex_shows;
DROP TABLE watch_ahead_plays;
DROP TABLE plex_history_position;
DROP TABLE request_watch_ahead;
