-- +goose Up
-- Owned by the library module: for a file that replaced others (an Upgrade), the
-- best Score of the files it replaced, so "Recently added" can show what the
-- Upgrade gained. A row goes with its file.
CREATE TABLE file_replaced_scores (
    file_id INTEGER PRIMARY KEY REFERENCES files (id) ON DELETE CASCADE,
    score   INTEGER NOT NULL
) STRICT;

-- +goose Down
DROP TABLE file_replaced_scores;
