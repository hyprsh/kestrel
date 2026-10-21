-- name: InsertRequest :one
INSERT INTO requests (source, source_request_id, requester_id, requester_name, title_id, title_name, outcome, reject_reason, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
SELECT request_id, slot, profile_key, version_id, filled_at FROM request_slots WHERE request_id = ? ORDER BY CASE slot WHEN 'standard' THEN 0 ELSE 1 END;

-- name: ListSeasonsOfRequest :many
SELECT season FROM request_seasons WHERE request_id = ? ORDER BY season;

-- name: MarkSlotFilled :exec
UPDATE request_slots SET filled_at = ? WHERE request_id = ? AND slot = ? AND filled_at IS NULL;
