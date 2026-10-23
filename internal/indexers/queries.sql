-- name: GrabCount :one
SELECT CAST(COALESCE(SUM(fetches), 0) AS INTEGER) FROM indexer_grab_counts WHERE indexer_id = ? AND day = ?;

-- name: CountGrab :exec
INSERT INTO indexer_grab_counts (indexer_id, day, fetches) VALUES (?, ?, 1)
ON CONFLICT (indexer_id, day) DO UPDATE SET fetches = fetches + 1;

-- name: UncountGrab :exec
UPDATE indexer_grab_counts SET fetches = MAX(fetches - 1, 0) WHERE indexer_id = ? AND day = ?;

-- name: PruneGrabCounts :exec
DELETE FROM indexer_grab_counts WHERE indexer_id = ? AND day < ?;
