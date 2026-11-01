-- name: GrabCount :one
SELECT CAST(COALESCE(SUM(grabs), 0) AS INTEGER) FROM indexer_grab_counts WHERE indexer_id = ? AND day = ?;

-- name: TakeGrab :execrows
-- Counts one Grab for the day while the day's count is below max_grabs, in one
-- statement so SQLite alone decides who gets the last slot: no row changes
-- (0 rows affected) once the count has reached it.
INSERT INTO indexer_grab_counts (indexer_id, day, grabs)
SELECT sqlc.arg(indexer_id), sqlc.arg(day), 1
WHERE COALESCE((SELECT c.grabs FROM indexer_grab_counts c WHERE c.indexer_id = sqlc.arg(indexer_id) AND c.day = sqlc.arg(day)), 0) < sqlc.arg(max_grabs)
ON CONFLICT (indexer_id, day) DO UPDATE SET grabs = grabs + 1;

-- name: UncountGrab :exec
UPDATE indexer_grab_counts SET grabs = MAX(grabs - 1, 0) WHERE indexer_id = ? AND day = ?;

-- name: PruneGrabCounts :exec
DELETE FROM indexer_grab_counts WHERE indexer_id = ? AND day < ?;

-- name: InsertSearch :one
INSERT INTO indexer_searches (indexer_id, indexer_name, at, ok, releases, duration_ms) VALUES (?, ?, ?, ?, ?, ?) RETURNING id;

-- name: MarkSearchesFit :exec
UPDATE indexer_searches SET fit = 1 WHERE id IN (SELECT value FROM json_each(?));

-- name: PruneSearches :exec
DELETE FROM indexer_searches WHERE at < ?;
