-- Watch-ahead (ADR 0019): the Requests that asked for their Series one season at a time.

-- name: MarkWatchAhead :exec
INSERT OR IGNORE INTO request_watch_ahead (request_id) VALUES (?);

-- name: ListWatchAheadRequests :many
SELECT r.id, r.title_id, r.created_at FROM requests r
JOIN request_watch_ahead w ON w.request_id = r.id
WHERE r.outcome = 'accepted' AND r.title_id IS NOT NULL
ORDER BY r.id;

-- name: AddRequestSeason :exec
INSERT OR IGNORE INTO request_seasons (request_id, season) VALUES (?, ?);
