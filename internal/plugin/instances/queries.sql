-- name: ListInstances :many
SELECT id, contract, plugin_id, name, enabled, priority, config, declared FROM plugin_instances
ORDER BY contract, priority, id;

-- name: GetInstance :one
SELECT id, contract, plugin_id, name, enabled, priority, config, declared FROM plugin_instances WHERE id = ?;

-- name: ListEnabledInstances :many
SELECT id, contract, plugin_id, name, enabled, priority, config, declared FROM plugin_instances
WHERE contract = ? AND enabled = 1
ORDER BY priority, id;

-- name: CountOtherEnabled :one
SELECT COUNT(*) FROM plugin_instances WHERE contract = ? AND enabled = 1 AND id <> ?;

-- name: InsertInstance :one
INSERT INTO plugin_instances (contract, plugin_id, name, enabled, priority, config, declared)
VALUES (?, ?, ?, ?, ?, ?, ?)
RETURNING id;

-- name: UpdateInstance :execrows
UPDATE plugin_instances SET name = ?, enabled = ?, priority = ?, config = ? WHERE id = ?;

-- name: DeclareInstance :execrows
UPDATE plugin_instances SET name = ?, enabled = ?, priority = ?, config = ?, declared = 1 WHERE id = ?;

-- name: UndeclareInstances :execrows
UPDATE plugin_instances SET declared = 0 WHERE declared = 1;

-- name: DeleteInstance :execrows
DELETE FROM plugin_instances WHERE id = ?;
