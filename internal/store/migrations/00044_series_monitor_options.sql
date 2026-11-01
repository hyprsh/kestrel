-- +goose Up
-- Owned by the library module: two Series-level switches beside the monitoring mode. `monitor_new_seasons` says
-- whether a season TheTVDB adds later is monitored (its episodes follow the mode when on, arrive unmonitored when
-- off); `monitor_specials` whether Specials (season 0) follow the mode too, which they never did before. Both are
-- only read for a Series; a Movie keeps the defaults.
ALTER TABLE titles ADD COLUMN monitor_new_seasons INTEGER NOT NULL DEFAULT 1 CHECK (monitor_new_seasons IN (0, 1));
ALTER TABLE titles ADD COLUMN monitor_specials INTEGER NOT NULL DEFAULT 0 CHECK (monitor_specials IN (0, 1));

-- +goose Down
ALTER TABLE titles DROP COLUMN monitor_specials;
ALTER TABLE titles DROP COLUMN monitor_new_seasons;
