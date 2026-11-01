-- +goose Up
-- What the Overview's statistics need and nothing else recorded.
--
-- Owned by the indexers module: one row per indexer lane of a search, with when it ran, whether the
-- indexer answered (`ok`), how many Releases it returned, whether any of them fit a Version's Slot
-- (`fit`, set by acquire once it has scored them), and how long the indexer took to answer. Rows
-- older than the longest Overview range are pruned as new ones are written.
CREATE TABLE indexer_searches (
    id           INTEGER PRIMARY KEY,
    indexer_id   INTEGER NOT NULL, -- the plugin instance; no FK, the instance may be deleted
    indexer_name TEXT    NOT NULL,
    at           TEXT    NOT NULL,
    ok           INTEGER NOT NULL CHECK (ok IN (0, 1)),
    releases     INTEGER NOT NULL DEFAULT 0 CHECK (releases >= 0),
    fit          INTEGER NOT NULL DEFAULT 0 CHECK (fit IN (0, 1)),
    duration_ms  INTEGER NOT NULL CHECK (duration_ms >= 0)
) STRICT;
CREATE INDEX indexer_searches_at ON indexer_searches (at);

-- Owned by the acquire module: when the download client first reported a Grab downloading, and when
-- it reported it finished. A Grab that the poll first saw finished starts at its creation.
ALTER TABLE grabs ADD COLUMN download_started_at TEXT;
ALTER TABLE grabs ADD COLUMN download_done_at TEXT;

-- +goose Down
ALTER TABLE grabs DROP COLUMN download_done_at;
ALTER TABLE grabs DROP COLUMN download_started_at;
DROP TABLE indexer_searches;
