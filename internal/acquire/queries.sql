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

-- A Grab is active from `sent` until its Import is done; one that stalled waits for a person.
-- name: ListActiveGrabs :many
SELECT * FROM grabs WHERE state IN ('sent', 'downloading', 'completed', 'importing') AND stalled_since IS NULL ORDER BY id;

-- Grabs whose download is still going: the poll follows these.
-- name: ListDownloadingGrabs :many
SELECT * FROM grabs WHERE state IN ('sent', 'downloading') ORDER BY id;

-- name: SetGrabState :exec
UPDATE grabs SET state = ?, failure = ?, updated_at = ? WHERE id = ?;

-- name: DeleteGrab :exec
DELETE FROM grabs WHERE id = ?;
