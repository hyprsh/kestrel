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
