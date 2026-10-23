-- +goose Up
-- How the Titles a plan adds are monitored (all, future or none), unless a row
-- says otherwise. A new plan starts at all.
ALTER TABLE adoption_plan ADD COLUMN monitor TEXT NOT NULL DEFAULT 'all';

-- +goose Down
ALTER TABLE adoption_plan DROP COLUMN monitor;
