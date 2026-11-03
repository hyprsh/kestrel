-- +goose Up
-- Every event says who or what started it (trigger_kind: person, api_key, sweep, rss, import, retry,
-- request, rule, startup or job; trigger_actor names the person and trigger_via the screen, API call
-- or loop) and why it happened (reason). Rows from before this are empty.
ALTER TABLE events ADD COLUMN trigger_kind  TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN trigger_actor TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN trigger_via   TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN reason        TEXT NOT NULL DEFAULT '';


-- Who asked for a search that is due now (a bulk Search from the Library): the history.Trigger key, so the sweep that
-- runs it can name the person in its Log entry. Cleared when the Version is searched.
ALTER TABLE search_state ADD COLUMN requested_by TEXT;

-- +goose Down
ALTER TABLE search_state DROP COLUMN requested_by;
ALTER TABLE events DROP COLUMN reason;
ALTER TABLE events DROP COLUMN trigger_via;
ALTER TABLE events DROP COLUMN trigger_actor;
ALTER TABLE events DROP COLUMN trigger_kind;
