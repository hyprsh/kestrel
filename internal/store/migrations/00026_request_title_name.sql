-- +goose Up
-- The name of the Title a Request asked for, as Kestrel learnt it when the
-- Request came in. A rejected Request has no Title to read it from, and a
-- Title removed later takes its name with it; the Requests list still says
-- what was asked for. Empty when Kestrel never learnt one (unknown_title, and
-- Requests stored before this column).
ALTER TABLE requests ADD COLUMN title_name TEXT NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE requests DROP COLUMN title_name;
