-- Read-only aggregates for the Overview. `from_at` and `to_at` are UTC RFC 3339 text, [from, to).

-- Finished Grabs per UTC day: Imported and Failed.
-- name: GrabsPerDay :many
SELECT substr(updated_at, 1, 10) AS day,
       CAST(COUNT(CASE WHEN state = 'imported' THEN 1 END) AS INTEGER) AS imported,
       CAST(COUNT(CASE WHEN state = 'failed' THEN 1 END) AS INTEGER) AS failed
FROM grabs
WHERE state IN ('imported', 'failed') AND updated_at >= sqlc.arg(from_at) AND updated_at < sqlc.arg(to_at)
GROUP BY day
ORDER BY day;

-- name: IndexerGrabs :many
SELECT indexer_id, CAST(MAX(indexer_name) AS TEXT) AS name,
       CAST(COUNT(CASE WHEN state = 'imported' THEN 1 END) AS INTEGER) AS imported,
       CAST(COUNT(CASE WHEN state = 'failed' THEN 1 END) AS INTEGER) AS failed
FROM grabs
WHERE state IN ('imported', 'failed') AND updated_at >= sqlc.arg(from_at) AND updated_at < sqlc.arg(to_at)
GROUP BY indexer_id;

-- name: IndexerSearchCounts :many
SELECT indexer_id, CAST(MAX(indexer_name) AS TEXT) AS name,
       CAST(COUNT(*) AS INTEGER) AS searches,
       CAST(COUNT(CASE WHEN ok = 1 THEN 1 END) AS INTEGER) AS answered,
       CAST(COUNT(CASE WHEN ok = 1 AND fit = 1 THEN 1 END) AS INTEGER) AS hits
FROM indexer_searches
WHERE at >= sqlc.arg(from_at) AND at < sqlc.arg(to_at)
GROUP BY indexer_id;

-- The time each answering indexer took, for the median.
-- name: IndexerAnswerTimes :many
SELECT indexer_id, duration_ms FROM indexer_searches
WHERE ok = 1 AND at >= sqlc.arg(from_at) AND at < sqlc.arg(to_at)
ORDER BY indexer_id, duration_ms;

-- Grabs the download client finished in the window, with the bytes and when it started.
-- name: Downloads :many
SELECT size, download_started_at, download_done_at FROM grabs
WHERE download_started_at IS NOT NULL AND download_done_at IS NOT NULL AND download_done_at >= sqlc.arg(from_at) AND download_done_at < sqlc.arg(to_at);

-- Grabs the client reported failed (a bad or encrypted download), not ones that Import rejected or that went missing.
-- name: ClientFailures :one
SELECT CAST(COUNT(*) AS INTEGER) FROM grabs
WHERE state = 'failed' AND failure IN ('download_failed', 'encrypted') AND updated_at >= sqlc.arg(from_at) AND updated_at < sqlc.arg(to_at);

-- name: LibraryTotals :one
SELECT CAST(COUNT(*) AS INTEGER) AS titles,
       CAST(COUNT(CASE WHEN kind = 'movie' THEN 1 END) AS INTEGER) AS movies,
       CAST(COUNT(CASE WHEN kind = 'series' THEN 1 END) AS INTEGER) AS series
FROM titles;

-- The size of every file by the kind of Title it belongs to.
-- name: FileBytesByKind :many
SELECT t.kind, CAST(COALESCE(SUM(f.size), 0) AS INTEGER) AS bytes
FROM files f JOIN versions v ON v.id = f.version_id JOIN titles t ON t.id = v.title_id
GROUP BY t.kind;

-- Every file's Slot and parse, for the quality split.
-- name: FileQualities :many
SELECT v.slot, f.parsed_release FROM files f JOIN versions v ON v.id = f.version_id;

-- Files that Grabs brought in the window: their size and parse (release group), and when.
-- name: GrabbedFiles :many
SELECT f.size, f.parsed_release, f.imported_at FROM files f JOIN grabs g ON g.id = f.grab_id
WHERE f.imported_at >= sqlc.arg(from_at) AND f.imported_at < sqlc.arg(to_at);

-- name: RequestsInWindow :many
SELECT r.id, r.source, r.requester_id, r.requester_name, r.created_at,
       CAST((SELECT COUNT(*) FROM request_slots s WHERE s.request_id = r.id) AS INTEGER) AS slots,
       CAST((SELECT COUNT(*) FROM request_slots s WHERE s.request_id = r.id AND s.filled_at IS NOT NULL) AS INTEGER) AS filled,
       CAST(COALESCE((SELECT MAX(s.filled_at) FROM request_slots s WHERE s.request_id = r.id AND s.filled_at IS NOT NULL), '') AS TEXT) AS filled_at
FROM requests r
WHERE r.outcome = 'accepted' AND r.created_at >= sqlc.arg(from_at) AND r.created_at < sqlc.arg(to_at)
ORDER BY r.id;
