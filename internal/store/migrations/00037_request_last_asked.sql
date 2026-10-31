-- +goose Up
-- Owned by the requests module: when the source last asked about a Request. Silo's CheckStatus
-- reads its Requests in bulk, and that read stamps `last_asked_at`; a Silo Request that has been
-- quiet for longer than Silo's retry span shows in Needs attention. `silence_dismissed` hides that
-- row until the source asks again (a new stamp clears it). A NULL stamp means "not yet known" and
-- reads as the creation time.
ALTER TABLE requests ADD COLUMN last_asked_at TEXT;
ALTER TABLE requests ADD COLUMN silence_dismissed INTEGER NOT NULL DEFAULT 0 CHECK (silence_dismissed IN (0, 1));

-- Silo has been polling the Requests that already exist, so the upgrade counts as the last ask:
-- otherwise every old open Silo Request would be flagged until Silo's next poll.
UPDATE requests SET last_asked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE source = 'silo';

-- +goose Down
ALTER TABLE requests DROP COLUMN silence_dismissed;
ALTER TABLE requests DROP COLUMN last_asked_at;
