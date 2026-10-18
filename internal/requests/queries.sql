-- name: InsertRequest :one
INSERT INTO requests (source, source_request_id, requester_id, requester_name, title_id, outcome, reject_reason, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
RETURNING id;

-- name: DeleteRequest :exec
DELETE FROM requests WHERE id = ?;

-- name: InsertRequestSlot :exec
INSERT INTO request_slots (request_id, slot, profile_key, version_id) VALUES (?, ?, ?, ?);

-- name: InsertRequestSeason :exec
INSERT INTO request_seasons (request_id, season) VALUES (?, ?);

-- name: GetRequest :one
SELECT * FROM requests WHERE id = ?;

-- name: GetRequestBySource :one
SELECT * FROM requests WHERE source = ? AND source_request_id = ?;

-- name: ListRequests :many
SELECT * FROM requests
WHERE id < sqlc.arg(before)
  AND (sqlc.arg(source) = '' OR source = sqlc.arg(source))
  AND (sqlc.arg(title_id) = 0 OR title_id = sqlc.arg(title_id))
ORDER BY id DESC
LIMIT sqlc.arg(max);

-- name: ListRequestsByTitle :many
SELECT * FROM requests WHERE title_id = ? ORDER BY id;

-- name: ListSlotsOfRequest :many
SELECT request_id, slot, profile_key, version_id FROM request_slots WHERE request_id = ? ORDER BY CASE slot WHEN 'sd' THEN 0 WHEN 'hd' THEN 1 ELSE 2 END;

-- name: ListSeasonsOfRequest :many
SELECT season FROM request_seasons WHERE request_id = ? ORDER BY season;
