-- +goose NO TRANSACTION
-- +goose Up
-- Owned by the slot module (ADR 0024): the Slots a library defines, replacing the fixed pair. `id` is a slug fixed at
-- creation; `label` is editable; `default_movies` and `default_series` name a Profile (key) or are NULL; `on_for_new`
-- says whether a new Title gets the Slot; `position` is the order, 0-based and gap-free. The rules (at most 4, at least one,
-- at least one on for new Titles, label shape) are the module's, not the table's.
--
-- The seeds are the two Slots the library always had, with today's default Profiles carried over from the Profiles that
-- are flagged default. Versions and Requests keep their Slot ids, so nothing changes on disk.
--
-- A Version's and a Request's `slot` may now name any Slot, so their CHECK (slot IN ('standard', '4k')) goes. SQLite
-- cannot drop a constraint, so both tables are rebuilt the way SQLite documents: foreign keys off (a DROP would otherwise
-- cascade into the files and Grabs under a Version), a transaction of our own around the rebuild, and a foreign key
-- check before the commit. Profiles keep their own Slot until they are detached from it.
CREATE TABLE slots (
    id             TEXT    PRIMARY KEY,
    label          TEXT    NOT NULL,
    default_movies TEXT,
    default_series TEXT,
    on_for_new     INTEGER NOT NULL CHECK (on_for_new IN (0, 1)),
    position       INTEGER NOT NULL
) STRICT;

INSERT INTO slots (id, label, default_movies, default_series, on_for_new, position) VALUES
    ('standard', 'Standard',
        (SELECT key FROM profiles WHERE slot = 'standard' AND default_movies = 1),
        (SELECT key FROM profiles WHERE slot = 'standard' AND default_series = 1), 1, 0),
    ('4k', '4K',
        (SELECT key FROM profiles WHERE slot = '4k' AND default_movies = 1),
        (SELECT key FROM profiles WHERE slot = '4k' AND default_series = 1), 0, 1);

PRAGMA foreign_keys = OFF;
BEGIN;

CREATE TABLE versions_new (
    id          INTEGER PRIMARY KEY,
    title_id    INTEGER NOT NULL REFERENCES titles (id) ON DELETE CASCADE,
    slot        TEXT    NOT NULL REFERENCES slots (id),
    profile_key TEXT    NOT NULL REFERENCES profiles (key),
    added_at    TEXT    NOT NULL,
    UNIQUE (title_id, slot)
) STRICT;
INSERT INTO versions_new (id, title_id, slot, profile_key, added_at) SELECT id, title_id, slot, profile_key, added_at FROM versions;
DROP TABLE versions;
ALTER TABLE versions_new RENAME TO versions;

CREATE TABLE request_slots_new (
    request_id  INTEGER NOT NULL REFERENCES requests (id) ON DELETE CASCADE,
    slot        TEXT    NOT NULL REFERENCES slots (id) ON DELETE CASCADE,
    profile_key TEXT,
    version_id  INTEGER REFERENCES versions (id) ON DELETE SET NULL,
    filled_at   TEXT,
    PRIMARY KEY (request_id, slot)
) STRICT;
INSERT INTO request_slots_new (request_id, slot, profile_key, version_id, filled_at) SELECT request_id, slot, profile_key, version_id, filled_at FROM request_slots;
DROP TABLE request_slots;
ALTER TABLE request_slots_new RENAME TO request_slots;
CREATE INDEX request_slots_version ON request_slots (version_id);

PRAGMA foreign_key_check;
COMMIT;
PRAGMA foreign_keys = ON;

-- +goose Down
PRAGMA foreign_keys = OFF;
BEGIN;

CREATE TABLE versions_old (
    id          INTEGER PRIMARY KEY,
    title_id    INTEGER NOT NULL REFERENCES titles (id) ON DELETE CASCADE,
    slot        TEXT    NOT NULL CHECK (slot IN ('standard', '4k')),
    profile_key TEXT    NOT NULL REFERENCES profiles (key),
    added_at    TEXT    NOT NULL,
    UNIQUE (title_id, slot)
) STRICT;
INSERT INTO versions_old (id, title_id, slot, profile_key, added_at) SELECT id, title_id, slot, profile_key, added_at FROM versions;
DROP TABLE versions;
ALTER TABLE versions_old RENAME TO versions;

CREATE TABLE request_slots_old (
    request_id  INTEGER NOT NULL REFERENCES requests (id) ON DELETE CASCADE,
    slot        TEXT    NOT NULL CHECK (slot IN ('standard', '4k')),
    profile_key TEXT,
    version_id  INTEGER REFERENCES versions (id) ON DELETE SET NULL,
    filled_at   TEXT,
    PRIMARY KEY (request_id, slot)
) STRICT;
INSERT INTO request_slots_old (request_id, slot, profile_key, version_id, filled_at) SELECT request_id, slot, profile_key, version_id, filled_at FROM request_slots;
DROP TABLE request_slots;
ALTER TABLE request_slots_old RENAME TO request_slots;
CREATE INDEX request_slots_version ON request_slots (version_id);

DROP TABLE slots;
PRAGMA foreign_key_check;
COMMIT;
PRAGMA foreign_keys = ON;
