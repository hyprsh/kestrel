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
UPDATE grabs SET state = ?, failure = ?, stalled_reason = NULL, stalled_since = NULL, next_import_at = NULL, import_checking = NULL, updated_at = ? WHERE id = ?;

-- name: InsertGrabEpisode :exec
INSERT INTO grab_episodes (grab_id, episode_id) VALUES (?, ?);

-- The episodes the active Grabs are fetching, per Version. A stalled Import still holds its episodes.
-- name: ListActiveGrabEpisodes :many
SELECT g.version_id, ge.episode_id
FROM grab_episodes ge JOIN grabs g ON g.id = ge.grab_id
WHERE g.state IN ('sent', 'downloading', 'completed', 'importing')
UNION
SELECT gv.version_id, ge.episode_id
FROM grab_episodes ge JOIN grabs g ON g.id = ge.grab_id JOIN grab_versions gv ON gv.grab_id = g.id
WHERE g.state IN ('sent', 'downloading', 'completed', 'importing');

-- The episodes of a Title its active Grabs are fetching. A stalled Import still holds its episodes.
-- name: ListActiveGrabEpisodesOfTitle :many
SELECT DISTINCT ge.episode_id
FROM grab_episodes ge JOIN grabs g ON g.id = ge.grab_id
WHERE g.title_id = ? AND g.state IN ('sent', 'downloading', 'completed', 'importing');

-- The Versions besides its first that a Grab also fills (one download, several Versions).
-- name: InsertGrabVersion :exec
INSERT INTO grab_versions (grab_id, version_id) VALUES (?, ?);

-- name: ListGrabVersions :many
SELECT grab_id, version_id FROM grab_versions ORDER BY grab_id, version_id;

-- name: ListGrabVersionsOf :many
SELECT version_id FROM grab_versions WHERE grab_id = ? ORDER BY version_id;

-- name: ListGrabEpisodes :many
SELECT episode_id FROM grab_episodes WHERE grab_id = ? ORDER BY episode_id;

-- The failure of the latest failed Grab of each Version that has one.
-- name: ListLastFailures :many
SELECT version_id, failure FROM grabs WHERE state = 'failed' AND version_id IS NOT NULL AND failure IS NOT NULL ORDER BY id;

-- Grabs newest first for GET /grabs, with the reason of the Blocklist entry their Release got (empty when none).
-- `states` is a JSON array or NULL (any state), as in the Log's ListEvents.
-- name: ListGrabs :many
SELECT sqlc.embed(g),
       CAST(coalesce((SELECT b.reason FROM blocklist b WHERE b.grab_id = g.id ORDER BY b.id DESC LIMIT 1), '') AS TEXT) AS blocklist_reason
FROM grabs g
WHERE (sqlc.narg(states) IS NULL OR g.state IN (SELECT value FROM json_each(sqlc.narg(states))))
  AND (sqlc.narg(stalled) IS NULL OR (g.stalled_since IS NOT NULL) = sqlc.narg(stalled))
  AND (sqlc.narg(since) IS NULL OR g.updated_at >= sqlc.narg(since))
  AND (sqlc.narg(before) IS NULL OR g.id < sqlc.narg(before))
ORDER BY g.id DESC
LIMIT sqlc.arg(max);

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
SELECT * FROM original_offers ORDER BY version_id, id;

-- name: ListOriginalOffersOfVersion :many
SELECT * FROM original_offers WHERE version_id = ? ORDER BY id;

-- name: DismissOriginalOffer :exec
UPDATE original_offers SET dismissed = 1 WHERE id = ?;

-- When the download client first reported a Grab downloading, and when it reported it finished (the Overview's speed and
-- download time). A Grab first seen finished started when it was created.
-- name: StampDownloadStart :exec
UPDATE grabs SET download_started_at = COALESCE(download_started_at, ?) WHERE id = ?;

-- name: StampDownloadDone :exec
UPDATE grabs SET download_started_at = COALESCE(download_started_at, created_at), download_done_at = COALESCE(download_done_at, ?) WHERE id = ?;

-- What the last search of each Version found; one row per Version, replaced by the next search.
-- name: UpsertVersionSearch :exec
INSERT INTO version_searches (version_id, at, releases, outcome, reasons, upgrade) VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT (version_id) DO UPDATE SET at = excluded.at, releases = excluded.releases, outcome = excluded.outcome,
                                       reasons = excluded.reasons, upgrade = excluded.upgrade;

-- `ids` is a JSON array of Version ids.
-- name: ListVersionSearches :many
SELECT * FROM version_searches WHERE version_id IN (SELECT value FROM json_each(sqlc.arg(ids)));

-- What the last search of each episode of a Version found; one row per Version and episode.
-- name: UpsertEpisodeSearch :exec
INSERT INTO episode_searches (version_id, episode_id, at, releases, outcome, reasons, upgrade) VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (version_id, episode_id) DO UPDATE SET at = excluded.at, releases = excluded.releases, outcome = excluded.outcome,
                                                   reasons = excluded.reasons, upgrade = excluded.upgrade;

-- name: ListEpisodeSearches :many
SELECT es.* FROM episode_searches es JOIN episodes e ON e.id = es.episode_id WHERE e.title_id = ?;

-- Why a Release was grabbed: the Wanted it covers, the files it replaces and the average Score gain.
-- name: SetGrabWhy :exec
UPDATE grabs SET covers_wanted = ?, replaces_files = ?, score_delta = ? WHERE id = ?;

-- How many downloaded files the running Import is checking.
-- name: SetImportChecking :exec
UPDATE grabs SET import_checking = ? WHERE id = ?;

-- How many library files a finished Import replaced.
-- name: SetImportReplaced :exec
UPDATE grabs SET import_replaced = ? WHERE id = ?;

-- The Grabs a connection outage holds up: those not yet imported, and those lost since it began.
-- name: CountUnfinishedGrabs :one
SELECT COUNT(*) FROM grabs WHERE state IN ('sent', 'downloading', 'completed', 'importing')
  AND (sqlc.arg(indexer_id) = 0 OR indexer_id = sqlc.arg(indexer_id));

-- name: CountLostGrabsSince :one
SELECT COUNT(*) FROM grabs WHERE state = 'failed' AND failure = 'lost' AND updated_at >= sqlc.arg(since)
  AND (sqlc.arg(indexer_id) = 0 OR indexer_id = sqlc.arg(indexer_id));
