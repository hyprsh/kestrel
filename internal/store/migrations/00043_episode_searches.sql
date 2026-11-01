-- +goose Up
-- Owned by the acquire module: what the last search of each episode of a Version found, beside the
-- Version's own row in version_searches. One row per Version and episode, replaced by every search that
-- asked the indexers for that episode. The columns mean what they do there, counted for the one episode:
-- `releases` is how many of the Releases named it (a season pack names every episode it holds).
CREATE TABLE episode_searches (
    version_id INTEGER NOT NULL REFERENCES versions (id) ON DELETE CASCADE,
    episode_id INTEGER NOT NULL REFERENCES episodes (id) ON DELETE CASCADE,
    at         TEXT    NOT NULL,
    releases   INTEGER NOT NULL CHECK (releases >= 0),
    outcome    TEXT    NOT NULL CHECK (outcome IN ('grabbed', 'nothing_fit', 'no_indexer', 'error')),
    reasons    TEXT    NOT NULL DEFAULT '[]',
    upgrade    INTEGER NOT NULL DEFAULT 0 CHECK (upgrade IN (0, 1)),
    PRIMARY KEY (version_id, episode_id)
) STRICT, WITHOUT ROWID;

-- +goose Down
DROP TABLE episode_searches;
