-- +goose Up
-- Owned by the indexers module: the NZB Fetches that returned an NZB, per indexer
-- and UTC day (`day` is days since the Unix epoch). Kestrel counts them itself, so
-- a Grab the admin cancels, or one the download client refuses, still counts
-- against the indexer's configured Grabs per day. Rows of past days are pruned
-- when a new Fetch is counted.
CREATE TABLE indexer_grab_counts (
    indexer_id INTEGER NOT NULL REFERENCES plugin_instances (id) ON DELETE CASCADE,
    day        INTEGER NOT NULL,
    fetches    INTEGER NOT NULL DEFAULT 0 CHECK (fetches >= 0),
    PRIMARY KEY (indexer_id, day)
) STRICT, WITHOUT ROWID;

-- +goose Down
DROP TABLE indexer_grab_counts;
