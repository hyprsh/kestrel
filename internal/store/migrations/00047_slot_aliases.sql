-- +goose Up
-- Owned by the slot module (ADR 0024): the labels a Slot used to have. Renaming a Slot's label renames its files and keeps
-- the old label here, so Adoption still recognises files and folders named before the change. Only Adoption reads it.
-- Matching ignores case, so the key does too.
CREATE TABLE slot_aliases (
    slot  TEXT NOT NULL REFERENCES slots (id) ON DELETE CASCADE,
    alias TEXT NOT NULL COLLATE NOCASE,
    PRIMARY KEY (slot, alias)
) STRICT;

-- +goose Down
DROP TABLE slot_aliases;
