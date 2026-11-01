-- +goose Up
-- Owned by the plugin instances module: how long the latest Test of an instance's saved connection
-- took, in ms. 0 means unknown (no Test yet); a call the app made for its own work leaves it alone.
ALTER TABLE plugin_instances ADD COLUMN check_latency_ms INTEGER NOT NULL DEFAULT 0 CHECK (check_latency_ms >= 0);

-- +goose Down
ALTER TABLE plugin_instances DROP COLUMN check_latency_ms;
