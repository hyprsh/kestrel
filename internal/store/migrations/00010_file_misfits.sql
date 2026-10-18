-- +goose Up
-- Owned by the library module: files that no longer fit their Version's Profile
-- (a Profile switch moved the bounds or the language rule past them). Their
-- Version counts as Wanted and any fitting Release replaces them whatever its
-- Score. A row goes with its file.
CREATE TABLE file_misfits (
    file_id INTEGER PRIMARY KEY REFERENCES files (id) ON DELETE CASCADE
) STRICT;

-- +goose Down
DROP TABLE file_misfits;
