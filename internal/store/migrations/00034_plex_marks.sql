-- +goose Up
-- Owned by the plexmarks module (ADR 0019): one row per Title Kestrel marked in
-- Plex. `item_id` and `section_key` name the Title's item (Plex's ratingKey and
-- library section) and `item_kind` is movie or series. `labels` is a JSON array
-- of only the labels Kestrel itself added, which are the only ones it takes
-- back, and `labelled_at` is when it first added any. `badge_at` is when the
-- "Requested" badge went on and `badge_until` when it comes off; while the
-- badge is on, `original_poster` is the key of the poster it replaced and
-- `badge_poster` the key of the uploaded badge poster, so Kestrel can tell
-- whether the item still shows its badge. Once the badge has come off,
-- `badge_at` stays (the Title is not badged a second time) and the poster
-- columns are NULL. Times are RFC 3339, UTC.
CREATE TABLE plex_marks (
    title_id        INTEGER PRIMARY KEY REFERENCES titles (id) ON DELETE CASCADE,
    instance_id     INTEGER NOT NULL REFERENCES plugin_instances (id) ON DELETE CASCADE,
    section_key     TEXT    NOT NULL,
    item_id         TEXT    NOT NULL,
    item_kind       TEXT    NOT NULL CHECK (item_kind IN ('movie', 'series')),
    labels          TEXT    NOT NULL DEFAULT '[]',
    labelled_at     TEXT,
    badge_at        TEXT,
    badge_until     TEXT,
    original_poster TEXT,
    badge_poster    TEXT
) STRICT;

-- +goose Down
DROP TABLE plex_marks;
