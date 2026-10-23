-- +goose Up
-- Owned by the health module: a failed media-server refresh is keyed by instance
-- id ("refresh_failed:7"), no longer by plugin id ("refresh_failed:plex"). The old
-- rows can never clear, so they go; the next failed refresh raises the new one.
DELETE FROM health_issues WHERE kind = 'refresh_failed' AND key NOT GLOB 'refresh_failed:[0-9]*';

-- +goose Down
SELECT 1;
