-- name: ListSlots :many
SELECT id, label, default_movies, default_series, on_for_new, position FROM slots ORDER BY position;

-- name: InsertSlot :exec
INSERT INTO slots (id, label, default_movies, default_series, on_for_new, position) VALUES (?, ?, ?, ?, ?, ?);

-- name: UpdateSlot :exec
UPDATE slots SET label = ?, default_movies = ?, default_series = ?, on_for_new = ?, position = ? WHERE id = ?;

-- name: SetSlotPosition :exec
UPDATE slots SET position = ? WHERE id = ?;

-- name: DeleteSlot :execrows
DELETE FROM slots WHERE id = ?;

-- name: SlotVersionCount :one
SELECT COUNT(*) FROM versions WHERE slot = ?;

-- name: ProfileKeys :many
SELECT key FROM profiles;

-- name: EnabledProfileKeys :many
SELECT key FROM profiles WHERE enabled = 1;
