-- +goose Up
-- Owned by the library module: files with the Title's Original Language but no
-- Primary-Language audio, held under a Profile that offers such Releases: they
-- came in through an accepted Original Offer. The Version counts as
-- filled, but any acceptable Release replaces them whatever its Score. A row
-- goes with its file.
CREATE TABLE file_originals (
    file_id INTEGER PRIMARY KEY REFERENCES files (id) ON DELETE CASCADE
) STRICT;

-- +goose Down
DROP TABLE file_originals;
