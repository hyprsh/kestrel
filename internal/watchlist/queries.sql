-- name: GetAccount :one
SELECT * FROM watchlist_accounts WHERE account_id = ?;

-- name: InsertAccount :exec
INSERT INTO watchlist_accounts (account_id, uuid, baseline_at) VALUES (?, ?, ?)
ON CONFLICT (account_id) DO NOTHING;

-- name: ListEntryGuids :many
SELECT plex_guid FROM watchlist_entries WHERE account_id = ?;

-- name: InsertEntry :exec
INSERT INTO watchlist_entries (account_id, plex_guid, kind, title, tmdb_id, tvdb_id, first_seen_at, request_id)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (account_id, plex_guid) DO NOTHING;
