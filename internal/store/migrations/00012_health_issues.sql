-- +goose Up
-- Owned by the health module: the rows of Needs attention that are raised by
-- conditions and clear themselves when the condition goes. `key` names the
-- condition (one row per key); a repeat Raise bumps count and last_at. Times are
-- RFC 3339 text like the events log. Stalled Imports and Long Missing are not
-- stored here; the api joins them in from acquire and library.
CREATE TABLE health_issues (
    id           INTEGER PRIMARY KEY,
    key          TEXT    NOT NULL UNIQUE,
    kind         TEXT    NOT NULL,
    severity     TEXT    NOT NULL CHECK (severity IN ('blocking', 'warning')),
    subject      TEXT    NOT NULL DEFAULT '{}', -- JSON: title_id, version_id, grab_id, plugin_instance_id
    message      TEXT    NOT NULL,
    dismissible  INTEGER NOT NULL DEFAULT 0 CHECK (dismissible IN (0, 1)),
    first_at     TEXT    NOT NULL,
    last_at      TEXT    NOT NULL,
    count        INTEGER NOT NULL DEFAULT 1,
    dismissed_at TEXT
);

-- +goose Down
DROP TABLE health_issues;
