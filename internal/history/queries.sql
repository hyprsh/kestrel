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

-- The Log: newest first; each filter is off when its argument is NULL. The list filters take a
-- JSON array and match any of its values (sqlc.slice cannot be switched off when empty).
-- name: ListEvents :many
SELECT * FROM events
WHERE (sqlc.narg(kinds) IS NULL OR kind IN (SELECT value FROM json_each(sqlc.narg(kinds))))
  AND (sqlc.narg(exclude_kinds) IS NULL OR kind NOT IN (SELECT value FROM json_each(sqlc.narg(exclude_kinds))))
  AND (sqlc.narg(title_ids) IS NULL OR title_id IN (SELECT value FROM json_each(sqlc.narg(title_ids))))
  AND (sqlc.narg(slots) IS NULL OR version_id IN (SELECT v.id FROM versions v WHERE v.slot IN (SELECT value FROM json_each(sqlc.narg(slots)))))
  AND (sqlc.arg(with_routine) = 1 OR routine = 0)
  AND (sqlc.narg(before) IS NULL OR id < sqlc.narg(before))
ORDER BY id DESC
LIMIT sqlc.arg(max_rows);
