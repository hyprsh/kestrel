-- +goose Up
-- A Series Version holds one file per episode. file_episodes carries the Version
-- so the database itself refuses a second file for the same (Version, episode):
-- a multi-episode file has one row per episode it holds. Nothing wrote the
-- table before Series Imports, so it is rebuilt empty-handed.
DROP TABLE file_episodes;
CREATE TABLE file_episodes (
    file_id    INTEGER NOT NULL REFERENCES files (id) ON DELETE CASCADE,
    version_id INTEGER NOT NULL REFERENCES versions (id) ON DELETE CASCADE,
    episode_id INTEGER NOT NULL REFERENCES episodes (id) ON DELETE CASCADE,
    PRIMARY KEY (file_id, episode_id),
    UNIQUE (version_id, episode_id)
) STRICT;

-- +goose Down
DROP TABLE file_episodes;
CREATE TABLE file_episodes (
    file_id    INTEGER NOT NULL REFERENCES files (id) ON DELETE CASCADE,
    episode_id INTEGER NOT NULL REFERENCES episodes (id) ON DELETE CASCADE,
    PRIMARY KEY (file_id, episode_id)
) STRICT;
