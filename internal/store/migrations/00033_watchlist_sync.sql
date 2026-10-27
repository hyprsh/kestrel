-- +goose Up
-- Owned by the watchlist module (ADR 0019). `watchlist_accounts` holds one row
-- per Plex account whose Watchlist Kestrel has taken as its baseline (the
-- titles on it then are never requested); `account_id` is the Plex account id,
-- `uuid` the account's plex.tv uuid. `watchlist_entries` holds one row per
-- Watchlist entry Kestrel has seen: `plex_guid` is the Plex guid, `kind` is
-- movie, series or other (which is never requested), `tmdb_id` and `tvdb_id`
-- what Plex's metadata resolved it to (NULL for none: such an entry is kept
-- and not looked up again, and the baseline's entries are never looked up),
-- `first_seen_at` when Kestrel first saw it and `request_id` the Request it
-- became, if any.
CREATE TABLE watchlist_accounts (
    account_id  TEXT PRIMARY KEY,
    uuid        TEXT NOT NULL,
    baseline_at TEXT NOT NULL
) STRICT;

CREATE TABLE watchlist_entries (
    account_id    TEXT    NOT NULL REFERENCES watchlist_accounts (account_id) ON DELETE CASCADE,
    plex_guid     TEXT    NOT NULL,
    kind          TEXT    NOT NULL CHECK (kind IN ('movie', 'series', 'other')),
    title         TEXT    NOT NULL,
    tmdb_id       INTEGER,
    tvdb_id       INTEGER,
    first_seen_at TEXT    NOT NULL,
    request_id    INTEGER REFERENCES requests (id) ON DELETE SET NULL,
    PRIMARY KEY (account_id, plex_guid)
) STRICT;

-- +goose Down
DROP TABLE watchlist_entries;
DROP TABLE watchlist_accounts;
