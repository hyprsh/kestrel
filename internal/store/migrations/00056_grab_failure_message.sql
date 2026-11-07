-- +goose Up
-- What the download client said about a failed download, in its own words. Kestrel removes the failed job from the
-- client, so this is the only copy. NULL when the client said nothing, and for a Grab that failed before it was kept.
ALTER TABLE grabs ADD COLUMN failure_message TEXT;

-- +goose Down
ALTER TABLE grabs DROP COLUMN failure_message;
