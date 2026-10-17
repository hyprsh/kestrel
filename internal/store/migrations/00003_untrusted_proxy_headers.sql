-- +goose Up
-- Owned by the api module. One row per client address that sent the reverse-proxy
-- user header without being a trusted proxy, so the later "Proxy header from an
-- untrusted address" Warning can surface it. Times are Unix seconds.
CREATE TABLE untrusted_proxy_headers (
    ip         TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    count      INTEGER NOT NULL,
    first_seen INTEGER NOT NULL,
    last_seen  INTEGER NOT NULL
) STRICT;

-- +goose Down
DROP TABLE untrusted_proxy_headers;
