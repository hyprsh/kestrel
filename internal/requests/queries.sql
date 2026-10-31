-- name: InsertRequest :one
INSERT INTO requests (source, source_request_id, requester_id, requester_name, title_id, title_name, outcome, reject_reason, created_at, last_asked_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

-- A list filter is a JSON array of the values to match any of, or NULL for none.
-- name: ListRequests :many
SELECT * FROM requests
WHERE id < sqlc.arg(before)
  AND (sqlc.narg(sources) IS NULL OR source IN (SELECT value FROM json_each(sqlc.narg(sources))))
  AND (sqlc.arg(title_id) = 0 OR title_id = sqlc.arg(title_id))
  AND (sqlc.narg(outcomes) IS NULL OR outcome IN (SELECT value FROM json_each(sqlc.narg(outcomes))))
  AND (sqlc.narg(requesters) IS NULL OR requester_id IN (SELECT value FROM json_each(sqlc.narg(requesters)))
       OR lower(requester_name) IN (SELECT lower(value) FROM json_each(sqlc.narg(requesters))))
  AND (sqlc.narg(requester_ids) IS NULL OR requester_id IN (SELECT value FROM json_each(sqlc.narg(requester_ids))))
ORDER BY id DESC
LIMIT sqlc.arg(max);

-- name: CountRequests :one
SELECT count(*) FROM requests
WHERE (sqlc.narg(sources) IS NULL OR source IN (SELECT value FROM json_each(sqlc.narg(sources))))
  AND (sqlc.arg(title_id) = 0 OR title_id = sqlc.arg(title_id))
  AND (sqlc.narg(outcomes) IS NULL OR outcome IN (SELECT value FROM json_each(sqlc.narg(outcomes))))
  AND (sqlc.narg(requesters) IS NULL OR requester_id IN (SELECT value FROM json_each(sqlc.narg(requesters)))
       OR lower(requester_name) IN (SELECT lower(value) FROM json_each(sqlc.narg(requesters))))
  AND (sqlc.narg(requester_ids) IS NULL OR requester_id IN (SELECT value FROM json_each(sqlc.narg(requester_ids))));

-- name: ListRequestsByTitle :many
SELECT * FROM requests WHERE title_id = ? ORDER BY id;

-- name: ListSlotsOfRequest :many
SELECT request_id, slot, profile_key, version_id, filled_at FROM request_slots WHERE request_id = ? ORDER BY CASE slot WHEN 'standard' THEN 0 ELSE 1 END;

-- name: ListSeasonsOfRequest :many
SELECT season FROM request_seasons WHERE request_id = ? ORDER BY season;

-- name: MarkSlotFilled :exec
UPDATE request_slots SET filled_at = ? WHERE request_id = ? AND slot = ? AND filled_at IS NULL;

-- The Titles with a Completed Slot, one row per Request that asked for it, with who asked.
-- name: ListCompletedTitles :many
SELECT DISTINCT t.id AS title_id, t.kind, t.tmdb_id, t.tvdb_id, t.root_folder, t.folder AS title_folder,
       r.id AS request_id, r.requester_name
FROM request_slots s
JOIN requests r ON r.id = s.request_id
JOIN titles t ON t.id = r.title_id
WHERE s.filled_at IS NOT NULL AND r.outcome = 'accepted' AND t.folder IS NOT NULL
ORDER BY t.id, r.id;

-- The source read these Requests: stamp them, and let a dismissed silence be flagged again.
-- name: MarkRequestsAsked :exec
UPDATE requests SET last_asked_at = sqlc.arg(at), silence_dismissed = 0
WHERE source = sqlc.arg(source) AND id IN (SELECT value FROM json_each(sqlc.arg(ids)));

-- The accepted Requests of a source that were last asked about before a time and not dismissed.
-- A NULL stamp reads as the creation time.
-- name: ListQuietRequests :many
SELECT * FROM requests
WHERE source = sqlc.arg(source) AND outcome = 'accepted' AND silence_dismissed = 0
  AND COALESCE(last_asked_at, created_at) < sqlc.arg(before)
ORDER BY id;

-- name: DismissQuietRequest :execrows
UPDATE requests SET silence_dismissed = 1 WHERE id = ? AND outcome = 'accepted';

-- A Request ended by hand ends as a rejected one does, with no reason code.
-- name: EndRequest :execrows
UPDATE requests SET outcome = 'rejected', reject_reason = NULL WHERE id = ? AND outcome = 'accepted';
