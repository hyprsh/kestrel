# Background work runs as state-driven reconcilers, not a job queue

Kestrel has no jobs table. All of its background work follows from domain state: a Version is missing or due an Upgrade search (`search_state.next_*_at`), a Grab is active or completed (`grabs.state`), a Title is stale (`titles.refreshed_at`). So the scheduler is a small in-memory set of periodic loops (RSS, sweep, download polling, Import, metadata refresh). Each loop is an idempotent "find what's due, do it" pass over those rows, and it can be kicked awake on demand. Adding a Version sets its `next_missing_at` to now and kicks the sweep. A restart resumes from the rows, because nothing lives outside them. We chose this to keep one source of truth. Rule changes such as a new sweep cadence take effect on the next pass, and removing a Version leaves no orphaned jobs behind.

## Considered Options

- **A persisted job queue in SQLite** (kind, payload, run_at, attempts, lease). Rejected because it is a second source of truth that can disagree with the domain rows: a job for a deleted Version, or a missing Version with no job. Already scheduled jobs would also keep stale `run_at` values whenever a rule changes.

## Consequences

- Every loop handler must be idempotent. A Grab left `importing` is imported again on start, and Import first checks whether the file is already in place.
- Retry and backoff live in the rows: `next_*_at`, the Grab state and indexer pause times. There are no per-job attempt counters.
- The "running now" list in the UI comes from memory. Past work shows in the `events` table.
- Work not tied to a row, such as a delayed webhook with retries, has no home. If it ever appears (notifications are out of scope for v1), a small queue for just that work can be added.
