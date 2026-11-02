-- +goose Up
-- Owned by the acquire module (ADR 0024): one Grab can fill several Versions of a Title, when the same Release is the pick
-- for each of them. grabs.version_id stays the first Version; the others are listed here, and Import links the one
-- downloaded file under each Version's own name.
CREATE TABLE grab_versions (
    grab_id    INTEGER NOT NULL REFERENCES grabs (id) ON DELETE CASCADE,
    version_id INTEGER NOT NULL REFERENCES versions (id) ON DELETE CASCADE,
    PRIMARY KEY (grab_id, version_id)
) STRICT;
CREATE INDEX grab_versions_version ON grab_versions (version_id);

-- +goose Down
DROP TABLE grab_versions;
