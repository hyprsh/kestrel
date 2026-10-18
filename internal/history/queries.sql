-- name: InsertEvent :one
INSERT INTO events (at, kind, routine, title_id, version_id, episode_id, grab_id, request_id, message, data)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
RETURNING id;

-- name: EventsAfter :many
SELECT * FROM events WHERE id > ? ORDER BY id LIMIT ?;

-- name: LastEventID :one
SELECT CAST(COALESCE(MAX(id), 0) AS INTEGER) FROM events;

-- name: PruneRoutineEvents :execrows
DELETE FROM events WHERE routine = 1 AND at < ?;

-- The Log: newest first; each filter is off when its argument is NULL.
-- name: ListEvents :many
SELECT * FROM events
WHERE (sqlc.narg(kind) IS NULL OR kind = sqlc.narg(kind))
  AND (sqlc.narg(title_id) IS NULL OR title_id = sqlc.narg(title_id))
  AND (sqlc.narg(slot) IS NULL OR version_id IN (SELECT v.id FROM versions v WHERE v.slot = sqlc.narg(slot)))
  AND (sqlc.arg(with_routine) = 1 OR routine = 0)
  AND (sqlc.narg(before) IS NULL OR id < sqlc.narg(before))
ORDER BY id DESC
LIMIT sqlc.arg(max_rows);
