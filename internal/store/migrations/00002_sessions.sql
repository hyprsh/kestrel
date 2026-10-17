-- +goose Up
-- Owned by the api module. `id` is the SHA-256 of the random cookie value, so a
-- leaked database does not hand out live sessions. Times are Unix seconds.
CREATE TABLE sessions (
    id         TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX sessions_expires_at ON sessions (expires_at);

-- +goose Down
DROP TABLE sessions;
