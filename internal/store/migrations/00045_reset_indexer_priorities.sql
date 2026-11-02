-- +goose Up
-- Indexer Priority now also sets the order automatic searches ask indexers in, by group (ADR 0025). Until now it
-- only broke ties, and reordering the Indexers list gave every indexer its own number, which would now make every
-- search ask the indexers one after another. Every indexer goes back to 0, asked together as before, so nobody
-- switches to asking in turn without choosing it. A declared instance gets its priority back from the Config File
-- at the next start.
UPDATE plugin_instances SET priority = 0 WHERE contract = 'indexer.v1';

-- +goose Down
-- The earlier priorities are gone; 0 everywhere is valid under the old meaning too.
SELECT 1;
