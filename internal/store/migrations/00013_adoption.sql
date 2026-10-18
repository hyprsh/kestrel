-- +goose Up
-- Owned by the imports module: the one pending Adoption plan. The scan writes
-- the rows, the admin edits them, the commit adopts the ticked ones and clears
-- them. `data` is the row's JSON (entry, match, candidates, files); `status`
-- and `ticked` are columns so the plan can be read in groups. `revision` moves
-- with every change so a commit can tell the plan it reviewed from a newer one.
CREATE TABLE adoption_plan (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    state      TEXT    NOT NULL CHECK (state IN ('idle', 'scanning', 'planned', 'committing')),
    revision   INTEGER NOT NULL DEFAULT 0,
    done       INTEGER NOT NULL DEFAULT 0,
    total      INTEGER NOT NULL DEFAULT 0,
    error      TEXT,
    scanned_at TEXT,
    adopted    INTEGER,
    failed     INTEGER
);

INSERT INTO adoption_plan (id, state) VALUES (1, 'idle');

CREATE TABLE adoption_rows (
    id     INTEGER PRIMARY KEY,
    status TEXT    NOT NULL CHECK (status IN ('matched', 'needs_choice', 'skipped')),
    ticked INTEGER NOT NULL DEFAULT 1 CHECK (ticked IN (0, 1)),
    data   TEXT    NOT NULL
);

-- +goose Down
DROP TABLE adoption_rows;
DROP TABLE adoption_plan;
