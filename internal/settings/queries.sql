-- name: Get :one
SELECT value FROM settings WHERE key = ?;

-- name: Put :exec
INSERT INTO settings (key, value) VALUES (?, ?)
ON CONFLICT (key) DO UPDATE SET value = excluded.value;

-- name: Insert :execrows
INSERT INTO settings (key, value) VALUES (?, ?)
ON CONFLICT (key) DO NOTHING;
