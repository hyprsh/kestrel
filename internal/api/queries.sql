-- name: CreateSession :exec
INSERT INTO sessions (id, created_at, expires_at) VALUES (?, ?, ?);

-- name: LiveSession :one
SELECT expires_at FROM sessions WHERE id = ? AND expires_at > ?;

-- name: SlideSession :exec
UPDATE sessions SET expires_at = ? WHERE id = ?;

-- name: DeleteSession :exec
DELETE FROM sessions WHERE id = ?;

-- name: DeleteOtherSessions :exec
DELETE FROM sessions WHERE id <> ?;

-- name: DeleteAllSessions :exec
DELETE FROM sessions;

-- name: PruneSessions :execrows
DELETE FROM sessions WHERE expires_at <= ?;
