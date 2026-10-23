-- +goose Up
-- Owned by the indexers module: the Grabs whose NZB an indexer handed over, per
-- indexer and UTC day (`day` is days since the Unix epoch). Kestrel counts them
-- itself, so a Grab the admin cancels, or one the download client refuses, still
-- counts against the indexer's configured Grabs per day. Rows of past days are
-- pruned when a new Grab is counted.
CREATE TABLE indexer_grab_counts (
    indexer_id INTEGER NOT NULL REFERENCES plugin_instances (id) ON DELETE CASCADE,
    day        INTEGER NOT NULL,
    grabs      INTEGER NOT NULL DEFAULT 0 CHECK (grabs >= 0),
    PRIMARY KEY (indexer_id, day)
) STRICT, WITHOUT ROWID;

-- +goose Down
DROP TABLE indexer_grab_counts;
