-- +goose Up
-- Owned by the jobs module: how the last passes of each background loop went, so the Health screen's
-- "Last 10" bars survive a restart. The runner keeps at most ten rows per loop (`name` is the loop's
-- internal name), pruning as it writes.
CREATE TABLE job_runs (
    id          INTEGER PRIMARY KEY,
    name        TEXT    NOT NULL,
    started_at  TEXT    NOT NULL,
    finished_at TEXT    NOT NULL,
    took_ms     INTEGER NOT NULL CHECK (took_ms >= 0),
    err         TEXT    NOT NULL DEFAULT '' -- the error the pass returned; empty when it succeeded
) STRICT;
CREATE INDEX job_runs_name ON job_runs (name, id);

-- +goose Down
DROP TABLE job_runs;
