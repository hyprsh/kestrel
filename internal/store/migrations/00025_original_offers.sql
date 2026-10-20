-- +goose Up
-- Owned by the acquire module: Original Offers. One row per Version and
-- unit (a Movie Version's one unit has no episode) holding the best Release
-- with the Title's Original Language but no Primary-Language audio found for
-- it, with everything a Grab needs, so Accept grabs exactly that Release however
-- old the offer is. A season pack is one row per episode it covers.
-- `dismissed` hides the row until a higher-scoring Release replaces it.
CREATE TABLE original_offers (
    id           INTEGER PRIMARY KEY,
    version_id   INTEGER NOT NULL REFERENCES versions (id) ON DELETE CASCADE,
    episode_id   INTEGER REFERENCES episodes (id) ON DELETE CASCADE,
    release_guid TEXT    NOT NULL,
    release_name TEXT    NOT NULL,
    indexer_id   INTEGER NOT NULL, -- no FK, the instance may be deleted
    indexer_name TEXT    NOT NULL,
    download_url TEXT    NOT NULL,
    size         INTEGER NOT NULL,
    published_at TEXT    NOT NULL,
    score        INTEGER NOT NULL,
    parsed       TEXT    NOT NULL, -- JSON snapshot of the parsed name
    verdict      TEXT    NOT NULL, -- JSON snapshot of the Verdict under the Version's Profile
    pack         INTEGER NOT NULL DEFAULT 0 CHECK (pack IN (0, 1)),
    found_at     TEXT    NOT NULL,
    dismissed    INTEGER NOT NULL DEFAULT 0 CHECK (dismissed IN (0, 1))
) STRICT;
CREATE UNIQUE INDEX original_offers_unit ON original_offers (version_id, coalesce(episode_id, 0));

-- +goose Down
DROP TABLE original_offers;
