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
