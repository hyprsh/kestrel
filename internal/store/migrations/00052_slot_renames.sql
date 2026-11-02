-- +goose Up
-- Owned by the imports module: the background jobs that rename a Slot's files after a new label (#323). One row per
-- Slot with a rename pending or running; the row is the job, so a restart picks it up again (Rename is idempotent).
-- done and total count Titles, for the Activity screen.
CREATE TABLE slot_renames (
    slot_id   TEXT    PRIMARY KEY,
    label     TEXT    NOT NULL,
    done      INTEGER NOT NULL DEFAULT 0,
    total     INTEGER NOT NULL DEFAULT 0,
    queued_at TEXT    NOT NULL
);

-- +goose Down
DROP TABLE slot_renames;
