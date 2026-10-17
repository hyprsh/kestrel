-- +goose Up
-- Owned by the history module: the append-only events log. Every loop change the
-- UI must see records a row; the SSE stream tails it by id. Rows outlive the
-- things they point at, so references are set NULL on delete. `routine` events
-- are pruned after 30 days, the rest are kept forever. request_id has no FK:
-- Requests arrive with their own table later.
CREATE TABLE events (
    id         INTEGER PRIMARY KEY,
    at         TEXT    NOT NULL,
    kind       TEXT    NOT NULL,
    routine    INTEGER NOT NULL DEFAULT 0 CHECK (routine IN (0, 1)),
    title_id   INTEGER REFERENCES titles (id) ON DELETE SET NULL,
    version_id INTEGER REFERENCES versions (id) ON DELETE SET NULL,
    episode_id INTEGER REFERENCES episodes (id) ON DELETE SET NULL,
    grab_id    INTEGER REFERENCES grabs (id) ON DELETE SET NULL,
    request_id INTEGER,
    message    TEXT    NOT NULL DEFAULT '',
    data       TEXT    -- JSON, discriminated by kind
);

CREATE INDEX events_routine_at ON events (routine, at);

-- +goose Down
DROP TABLE events;
