-- +goose Up
CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL CHECK (json_valid(value))
) STRICT;

-- +goose Down
DROP TABLE settings;
