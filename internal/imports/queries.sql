-- name: GetAdoptionPlan :one
SELECT * FROM adoption_plan WHERE id = 1;

-- name: SetAdoptionState :exec
UPDATE adoption_plan SET state = ?, revision = revision + 1, error = ? WHERE id = 1;

-- name: StartAdoptionScan :exec
UPDATE adoption_plan SET state = 'scanning', revision = revision + 1, done = 0, total = 0, error = NULL, scanned_at = NULL, adopted = NULL, failed = NULL, adopted_titles = NULL WHERE id = 1;

-- name: SetAdoptionProgress :exec
UPDATE adoption_plan SET done = ?, total = ? WHERE id = 1;

-- name: FinishAdoptionScan :exec
UPDATE adoption_plan SET state = 'planned', revision = revision + 1, scanned_at = ? WHERE id = 1;

-- name: FailAdoptionScan :exec
UPDATE adoption_plan SET state = 'idle', revision = revision + 1, error = ? WHERE id = 1;

-- name: BumpAdoptionRevision :exec
UPDATE adoption_plan SET revision = revision + 1 WHERE id = 1;

-- name: StartAdoptionCommit :exec
UPDATE adoption_plan SET state = 'committing', revision = revision + 1, done = 0, total = ? WHERE id = 1;

-- name: FinishAdoptionCommit :exec
UPDATE adoption_plan SET state = 'idle', revision = revision + 1, adopted = ?, failed = ?, adopted_titles = ? WHERE id = 1;

-- name: ResetAdoption :exec
UPDATE adoption_plan SET state = 'idle', revision = revision + 1, done = 0, total = 0, error = NULL, scanned_at = NULL, adopted = NULL, failed = NULL, adopted_titles = NULL WHERE id = 1;

-- name: InsertAdoptionRow :one
INSERT INTO adoption_rows (status, ticked, data) VALUES (?, ?, ?) RETURNING id;

-- name: ListAdoptionRows :many
SELECT * FROM adoption_rows ORDER BY id;

-- name: GetAdoptionRow :one
SELECT * FROM adoption_rows WHERE id = ?;

-- name: UpdateAdoptionRow :exec
UPDATE adoption_rows SET status = ?, ticked = ?, data = ? WHERE id = ?;

-- name: DeleteAdoptionRows :exec
DELETE FROM adoption_rows;
