-- name: CreateSession :exec
INSERT INTO sessions (id, created_at, expires_at) VALUES (?, ?, ?);

-- name: CreateRequesterSession :exec
INSERT INTO sessions (id, created_at, expires_at, requester_id, requester_name, requester_title, access_checked_at)
VALUES (?, ?, ?, ?, ?, ?, ?);

-- name: LiveSession :one
SELECT expires_at, requester_id, requester_name, requester_title, access_checked_at
FROM sessions WHERE id = ? AND expires_at > ?;

-- name: MarkAccessChecked :exec
UPDATE sessions SET access_checked_at = ? WHERE id = ?;

-- name: SlideSession :exec
UPDATE sessions SET expires_at = ? WHERE id = ?;

-- name: DeleteSession :exec
DELETE FROM sessions WHERE id = ?;

-- Changing the admin password ends the admin's sessions, not the Requesters'.
-- name: DeleteOtherAdminSessions :exec
DELETE FROM sessions WHERE id <> ? AND requester_id IS NULL;

-- name: DeleteAdminSessions :exec
DELETE FROM sessions WHERE requester_id IS NULL;

-- name: DeleteAllSessions :exec
DELETE FROM sessions;

-- name: PruneSessions :execrows
DELETE FROM sessions WHERE expires_at <= ?;

-- name: RecordUntrustedProxyHeader :exec
INSERT INTO untrusted_proxy_headers (ip, value, count, first_seen, last_seen)
VALUES (?1, ?2, 1, ?3, ?3)
ON CONFLICT (ip) DO UPDATE SET value = excluded.value, count = count + 1, last_seen = excluded.last_seen;

-- name: ListUntrustedProxyHeaders :many
SELECT ip, value, count, last_seen FROM untrusted_proxy_headers ORDER BY last_seen DESC, ip LIMIT 50;

-- Grabs made per indexer instance since a time (RFC3339, UTC; created_at is stored the same way).
-- name: CountGrabsByIndexerSince :many
SELECT indexer_id, COUNT(*) AS grabs FROM grabs WHERE created_at >= ? GROUP BY indexer_id;

-- Per Profile: the Titles with a Version under it and the files in those Versions.
-- name: ProfileUsage :many
SELECT v.profile_key, COUNT(DISTINCT v.title_id) AS titles, COUNT(f.id) AS files
FROM versions v LEFT JOIN files f ON f.version_id = v.id
GROUP BY v.profile_key;
