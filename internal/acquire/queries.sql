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

-- Grabs whose download the poll watches for failure and for going missing.
-- name: ListTrackedGrabs :many
SELECT * FROM grabs WHERE state IN ('sent', 'downloading', 'completed') ORDER BY id;

-- Imports that wait for the environment to be fixed.
-- name: ListStalledGrabs :many
SELECT * FROM grabs WHERE state = 'importing' AND stalled_since IS NOT NULL ORDER BY stalled_since, id;

-- A person's "Retry now": the stalled Import is due at once.
-- name: RetryStalledImport :execrows
UPDATE grabs SET next_import_at = ?, updated_at = ? WHERE id = ? AND state = 'importing' AND stalled_since IS NOT NULL;

-- name: SetGrabState :exec
UPDATE grabs SET state = ?, failure = ?, updated_at = ? WHERE id = ?;

-- name: DeleteGrab :exec
DELETE FROM grabs WHERE id = ?;

-- Grabs the Import should look at: finished downloads, Imports that were running
-- when the process died, and stalled Imports whose retry time has come.
-- name: ListImportableGrabs :many
SELECT * FROM grabs
WHERE state = 'completed'
   OR (state = 'importing' AND (stalled_since IS NULL OR next_import_at <= ?))
ORDER BY id;

-- name: StartImport :exec
UPDATE grabs SET state = 'importing', updated_at = ? WHERE id = ? AND state = 'completed';

-- name: StallImport :exec
UPDATE grabs SET stalled_reason = ?, stalled_since = COALESCE(stalled_since, ?), next_import_at = ?, updated_at = ? WHERE id = ?;

-- name: FinishGrab :exec
UPDATE grabs SET state = ?, failure = ?, stalled_reason = NULL, stalled_since = NULL, next_import_at = NULL, updated_at = ? WHERE id = ?;

-- name: InsertGrabEpisode :exec
INSERT INTO grab_episodes (grab_id, episode_id) VALUES (?, ?);

-- The episodes the active Grabs are fetching, per Version. A stalled Import still holds its episodes.
-- name: ListActiveGrabEpisodes :many
SELECT g.version_id, ge.episode_id
FROM grab_episodes ge JOIN grabs g ON g.id = ge.grab_id
WHERE g.state IN ('sent', 'downloading', 'completed', 'importing');

-- name: ListGrabEpisodes :many
SELECT episode_id FROM grab_episodes WHERE grab_id = ? ORDER BY episode_id;
