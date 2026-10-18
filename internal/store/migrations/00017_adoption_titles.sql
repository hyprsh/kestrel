-- +goose Up
-- Owned by the imports module: the ids of the Titles the last Adoption commit
-- adopted (a JSON array), so "Clean up adopted folders" can be limited to them.
ALTER TABLE adoption_plan ADD COLUMN adopted_titles TEXT;

-- +goose Down
ALTER TABLE adoption_plan DROP COLUMN adopted_titles;
