-- +goose Up
-- Owned by the library module: what Upcoming shows around a Series' episodes.
-- `network` is the first network TMDB lists, `tvdb_status` TheTVDB's status
-- ("continuing", "ended" or "upcoming"), `air_time` the time of day ("21:00")
-- the Series airs at and `air_timezone` the IANA zone of its network, which that
-- time is in. All are '' until the Title is added or refreshed with them known;
-- a Series without an air time counts as airing at the start of its air date.
-- `episodes.overview` is TheTVDB's synopsis of the episode.
ALTER TABLE titles ADD COLUMN network TEXT NOT NULL DEFAULT '';
ALTER TABLE titles ADD COLUMN tvdb_status TEXT NOT NULL DEFAULT '';
ALTER TABLE titles ADD COLUMN air_time TEXT NOT NULL DEFAULT '';
ALTER TABLE titles ADD COLUMN air_timezone TEXT NOT NULL DEFAULT '';
ALTER TABLE episodes ADD COLUMN overview TEXT NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE episodes DROP COLUMN overview;
ALTER TABLE titles DROP COLUMN air_timezone;
ALTER TABLE titles DROP COLUMN air_time;
ALTER TABLE titles DROP COLUMN tvdb_status;
ALTER TABLE titles DROP COLUMN network;
