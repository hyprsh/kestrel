-- name: InsertGrab :one
INSERT INTO grabs (title_id, version_id, release_guid, release_name, indexer_id, indexer_name, size, published_at, score,
                   parsed, verdict, overridden, is_upgrade, client_instance_id, client_id, state, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?)
RETURNING *;

-- name: GetGrab :one
SELECT * FROM grabs WHERE id = ?;

-- name: FindBlocklisted :many
SELECT * FROM blocklist WHERE (indexer_id = ? AND guid = ?) OR release_name = ?;

-- name: InsertBlocklist :one
INSERT INTO blocklist (release_name, indexer_id, guid, published_at, size, reason, title_id, grab_id, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
RETURNING *;
