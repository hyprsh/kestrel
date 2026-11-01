-- +goose Up
-- The facts the Title page, the Log and Activity show of a search, a Grab and an Import.
--
-- Owned by the acquire module: what the last search of each Version found. One row per Version,
-- replaced by every search that asked the indexers for it. `releases` is how many Releases came
-- back, `outcome` how the search ended (grabbed, nothing_fit, no_indexer or error) and `reasons`
-- a JSON list of {code, count}: how many of those Releases the Version's Profile rejected, per
-- rejection code. `upgrade` says the search was an Upgrade search, not one for what is missing.
CREATE TABLE version_searches (
    version_id INTEGER PRIMARY KEY REFERENCES versions (id) ON DELETE CASCADE,
    at         TEXT    NOT NULL,
    releases   INTEGER NOT NULL CHECK (releases >= 0),
    outcome    TEXT    NOT NULL CHECK (outcome IN ('grabbed', 'nothing_fit', 'no_indexer', 'error')),
    reasons    TEXT    NOT NULL DEFAULT '[]',
    upgrade    INTEGER NOT NULL DEFAULT 0 CHECK (upgrade IN (0, 1))
) STRICT;

-- Why a Release was grabbed, as the Grab was made: how many Wanted it covers, how many existing
-- files it replaces and the average Score gain over those files. NULL on Grabs from before.
ALTER TABLE grabs ADD COLUMN covers_wanted INTEGER;
ALTER TABLE grabs ADD COLUMN replaces_files INTEGER;
ALTER TABLE grabs ADD COLUMN score_delta INTEGER;
-- How many downloaded files the running Import is checking, and how many files in the library the
-- finished Import replaced. NULL until the Import says.
ALTER TABLE grabs ADD COLUMN import_checking INTEGER;
ALTER TABLE grabs ADD COLUMN import_replaced INTEGER;

-- +goose Down
ALTER TABLE grabs DROP COLUMN import_replaced;
ALTER TABLE grabs DROP COLUMN import_checking;
ALTER TABLE grabs DROP COLUMN score_delta;
ALTER TABLE grabs DROP COLUMN replaces_files;
ALTER TABLE grabs DROP COLUMN covers_wanted;
DROP TABLE version_searches;
