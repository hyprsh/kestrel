-- +goose Up
-- Owned by the plugin instances module: 1 marks an instance the Config File
-- declared (ADR 0014), so it is deleted once it leaves the file, and an
-- instance created in the UI (0) is never touched by the file.
ALTER TABLE plugin_instances ADD COLUMN declared INTEGER NOT NULL DEFAULT 0 CHECK (declared IN (0, 1));

-- +goose Down
ALTER TABLE plugin_instances DROP COLUMN declared;
