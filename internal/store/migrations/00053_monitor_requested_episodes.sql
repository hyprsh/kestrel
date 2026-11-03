-- +goose Up
-- #381: a Series Request added the Series in mode none and monitored only the requested seasons, and a refresh then added
-- new episodes of those seasons unmonitored. Monitor what that left behind: episodes without a file, in a monitored season
-- of a mode-none Series, that are unaired or aired in the last 30 days. Nothing records when an episode was inserted, so
-- older unmonitored episodes may be the admin's choice and stay as they are. Specials are never monitored automatically.
UPDATE episodes SET monitored = 1
WHERE monitored = 0
  AND season > 0
  AND (air_date IS NULL OR air_date >= date('now', '-30 days'))
  AND title_id IN (SELECT id FROM titles WHERE kind = 'series' AND series_monitor = 'none')
  AND EXISTS (SELECT 1 FROM seasons s WHERE s.title_id = episodes.title_id AND s.number = episodes.season AND s.monitored = 1)
  AND NOT EXISTS (SELECT 1 FROM file_episodes fe WHERE fe.episode_id = episodes.id);

-- +goose Down
-- A data fix: nothing to undo.
SELECT 1;
