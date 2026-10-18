-- name: GetIssueByKey :one
SELECT * FROM health_issues WHERE key = ?;

-- name: InsertIssue :exec
INSERT INTO health_issues (key, kind, severity, subject, message, dismissible, first_at, last_at, count)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1);

-- name: BumpIssue :exec
UPDATE health_issues
SET kind = ?, severity = ?, subject = ?, message = ?, dismissible = ?, last_at = ?, count = count + 1, dismissed_at = NULL
WHERE key = ?;

-- name: DeleteIssue :execrows
DELETE FROM health_issues WHERE key = ?;

-- name: ListIssues :many
SELECT * FROM health_issues ORDER BY id;

-- name: DismissIssue :execrows
UPDATE health_issues SET dismissed_at = ? WHERE id = ? AND dismissible = 1;
