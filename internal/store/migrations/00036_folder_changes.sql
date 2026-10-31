-- +goose Up
-- The folder-change feed. `folder_changes` is owned by the imports module: one
-- row per Title folder change that settled (see imports.Refresher), read by
-- `GET /folder-changes` through a marker `fc1:<id>`. The daily prune deletes a
-- prefix of ids older than 30 days and never the newest row, so a marker's
-- answerability is decided by the id range alone. `at` is RFC 3339, UTC, whole
-- seconds.
CREATE TABLE folder_changes (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    at   TEXT NOT NULL,
    path TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('created','modified','deleted'))
) STRICT;

CREATE INDEX folder_changes_path ON folder_changes (path, id);

-- +goose Down
DROP TABLE folder_changes;
