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

-- name: VersionCount :one
SELECT COUNT(*) FROM versions;

-- name: ProfileKeys :many
SELECT key FROM profiles;

-- name: EnabledProfileKeys :many
SELECT key FROM profiles WHERE enabled = 1;

-- name: ListSlotAliases :many
SELECT slot, alias FROM slot_aliases ORDER BY slot, alias;

-- name: InsertSlotAlias :exec
INSERT OR IGNORE INTO slot_aliases (slot, alias) VALUES (?, ?);

-- name: DeleteAliasesNamed :exec
DELETE FROM slot_aliases WHERE alias = ?;

-- name: SlotFileCount :one
SELECT COUNT(*) FROM files f JOIN versions v ON v.id = f.version_id WHERE v.slot = ?;

-- name: SlotTitleIDs :many
SELECT DISTINCT title_id FROM versions WHERE slot = ? ORDER BY title_id;

-- The Profiles that apply to a kind: those a TRaSH profile backs for it under the Primary Language (ADR 0026).
-- name: MoviesProfileKeys :many
SELECT key FROM profiles WHERE trash_profile_movies <> '';

-- name: SeriesProfileKeys :many
SELECT key FROM profiles WHERE trash_profile_series <> '';
