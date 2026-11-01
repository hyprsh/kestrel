-- name: InsertJobRun :exec
INSERT INTO job_runs (name, started_at, finished_at, took_ms, err) VALUES (?, ?, ?, ?, ?);

-- Keeps the newest `keep` runs of a loop.
-- name: PruneJobRuns :exec
DELETE FROM job_runs WHERE job_runs.name = sqlc.arg(job)
  AND id NOT IN (SELECT newest.id FROM job_runs AS newest WHERE newest.name = sqlc.arg(job) ORDER BY newest.id DESC LIMIT sqlc.arg(keep));

-- name: ListJobRuns :many
SELECT name, started_at, finished_at, took_ms, err FROM job_runs ORDER BY id;
