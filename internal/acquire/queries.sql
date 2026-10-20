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

-- The episodes of a Title its active Grabs are fetching. A stalled Import still holds its episodes.
-- name: ListActiveGrabEpisodesOfTitle :many
SELECT DISTINCT ge.episode_id
FROM grab_episodes ge JOIN grabs g ON g.id = ge.grab_id
WHERE g.title_id = ? AND g.state IN ('sent', 'downloading', 'completed', 'importing');

-- name: ListGrabEpisodes :many
SELECT episode_id FROM grab_episodes WHERE grab_id = ? ORDER BY episode_id;

-- The failure of the latest failed Grab of each Version that has one.
-- name: ListLastFailures :many
SELECT version_id, failure FROM grabs WHERE state = 'failed' AND version_id IS NOT NULL AND failure IS NOT NULL ORDER BY id;

-- name: ListBlocklist :many
SELECT * FROM blocklist WHERE (sqlc.narg(title_id) IS NULL OR title_id = sqlc.narg(title_id)) ORDER BY id DESC;

-- name: DeleteBlocklist :execrows
DELETE FROM blocklist WHERE id = ?;

-- name: GetOriginalOffer :one
SELECT * FROM original_offers WHERE version_id = ? AND coalesce(episode_id, 0) = ?;

-- name: InsertOriginalOffer :exec
INSERT INTO original_offers (version_id, episode_id, release_guid, release_name, indexer_id, indexer_name, download_url,
    size, published_at, score, parsed, verdict, pack, found_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);

-- name: DeleteOriginalOffer :exec
DELETE FROM original_offers WHERE id = ?;

-- name: ListOriginalOffers :many
SELECT o.id, o.version_id, o.episode_id, o.release_guid, o.release_name, o.indexer_id, o.indexer_name, o.download_url,
    o.size, o.published_at, o.score, o.parsed, o.verdict, o.pack, o.found_at, o.dismissed, v.title_id
FROM original_offers o JOIN versions v ON v.id = o.version_id
ORDER BY o.version_id, o.id;

-- name: DismissOriginalOffers :exec
UPDATE original_offers SET dismissed = 1 WHERE version_id = ?;

-- name: DeleteOriginalOffersOfRelease :exec
DELETE FROM original_offers WHERE version_id = ? AND indexer_id = ? AND release_guid = ?;
