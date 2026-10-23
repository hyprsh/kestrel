-- +goose Up
-- Owned by the plugin instances module: the latest check or observed call of an
-- instance. `checked_at` is RFC 3339 UTC, '' until the first one. `check_ok` is
-- 1 for a good call; for a bad one `check_code` is the plugin error code
-- ("auth", "unavailable", ...) and `check_message` its text.
ALTER TABLE plugin_instances ADD COLUMN checked_at TEXT NOT NULL DEFAULT '';
ALTER TABLE plugin_instances ADD COLUMN check_ok INTEGER NOT NULL DEFAULT 0 CHECK (check_ok IN (0, 1));
ALTER TABLE plugin_instances ADD COLUMN check_code TEXT NOT NULL DEFAULT '';
ALTER TABLE plugin_instances ADD COLUMN check_message TEXT NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE plugin_instances DROP COLUMN check_message;
ALTER TABLE plugin_instances DROP COLUMN check_code;
ALTER TABLE plugin_instances DROP COLUMN check_ok;
ALTER TABLE plugin_instances DROP COLUMN checked_at;
