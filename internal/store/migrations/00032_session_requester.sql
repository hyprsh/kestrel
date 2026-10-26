-- +goose Up
-- Owned by the api module. A session belongs to the admin (the three requester
-- columns NULL) or to a Requester who signed in with Plex (ADR 0018):
-- `requester_id` is their Plex account id, `requester_name` their Plex username
-- (a Plex Home user's name when it has none) and `requester_title` the
-- account's display name, which the list of users may name too.
-- `access_checked_at` is when their access to the Plex server was last
-- confirmed, in Unix seconds.
ALTER TABLE sessions ADD COLUMN requester_id TEXT;
ALTER TABLE sessions ADD COLUMN requester_name TEXT;
ALTER TABLE sessions ADD COLUMN requester_title TEXT;
ALTER TABLE sessions ADD COLUMN access_checked_at INTEGER;

-- +goose Down
ALTER TABLE sessions DROP COLUMN access_checked_at;
ALTER TABLE sessions DROP COLUMN requester_title;
ALTER TABLE sessions DROP COLUMN requester_name;
ALTER TABLE sessions DROP COLUMN requester_id;
