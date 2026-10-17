-- name: InsertTitle :one
INSERT INTO titles (kind, tmdb_id, tvdb_id, imdb_id, title, original_title, primary_title, year, original_language,
                    overview, runtime, poster_path, monitored, series_monitor, root_folder, added_at, refreshed_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
RETURNING id;

-- name: InsertAlias :exec
INSERT INTO title_aliases (title_id, alias, country, language) VALUES (?, ?, ?, ?);

-- name: InsertReleaseDate :exec
INSERT INTO title_release_dates (title_id, country, type, date, certification) VALUES (?, ?, ?, ?, ?);

-- name: InsertVersion :one
INSERT INTO versions (title_id, slot, profile_key, added_at) VALUES (?, ?, ?, ?) RETURNING id;

-- name: InsertSearchState :exec
INSERT INTO search_state (version_id, season, next_missing_at, next_upgrade_at) VALUES (?, ?, ?, ?);

-- name: GetTitleOfVersion :one
SELECT title_id FROM versions WHERE id = ?;

-- name: GetTitle :one
SELECT * FROM titles WHERE id = ?;

-- name: ListTitles :many
SELECT * FROM titles ORDER BY added_at DESC, id DESC;

-- name: ListVersions :many
SELECT id, title_id, slot, profile_key, added_at FROM versions ORDER BY title_id, id;

-- name: ListVersionsOfTitle :many
SELECT id, title_id, slot, profile_key, added_at FROM versions WHERE title_id = ? ORDER BY id;

-- name: ListFiles :many
SELECT id, version_id, path, size, release_name, parsed_release, probe, score, grab_id, imported_at FROM files;

-- name: ListFilesOfTitle :many
SELECT f.id, f.version_id, f.path, f.size, f.release_name, f.parsed_release, f.probe, f.score, f.grab_id, f.imported_at
FROM files f JOIN versions v ON v.id = f.version_id WHERE v.title_id = ?;

-- name: ListAllReleaseDates :many
SELECT title_id, country, type, date, certification FROM title_release_dates;

-- name: ListReleaseDatesOfTitle :many
SELECT title_id, country, type, date, certification FROM title_release_dates WHERE title_id = ?;

-- name: ListAliasesOfTitle :many
SELECT alias, country, language FROM title_aliases WHERE title_id = ? ORDER BY id;

-- name: ListAliasesForSearch :many
SELECT title_id, alias FROM title_aliases;

-- name: FindTitlesByTMDB :many
SELECT id, tmdb_id FROM titles WHERE kind = ? AND tmdb_id IS NOT NULL;

-- name: FindTitleByTVDB :one
SELECT id FROM titles WHERE kind = 'series' AND tvdb_id = ?;

-- name: InsertSeason :exec
INSERT INTO seasons (title_id, number, monitored) VALUES (?, ?, ?);

-- name: InsertEpisode :exec
INSERT INTO episodes (title_id, season, number, tvdb_id, name, air_date, monitored) VALUES (?, ?, ?, ?, ?, ?, ?);

-- name: ListSeasonsOfTitle :many
SELECT title_id, number, monitored FROM seasons WHERE title_id = ? ORDER BY number;

-- name: ListEpisodes :many
SELECT id, title_id, season, number, tvdb_id, name, air_date, monitored FROM episodes ORDER BY title_id, season, number;

-- name: ListEpisodesOfTitle :many
SELECT id, title_id, season, number, tvdb_id, name, air_date, monitored FROM episodes WHERE title_id = ? ORDER BY season, number;

-- name: ListFileEpisodes :many
SELECT f.version_id, fe.episode_id, f.score FROM file_episodes fe JOIN files f ON f.id = fe.file_id;

-- name: ListFileEpisodesOfTitle :many
SELECT f.version_id, fe.episode_id, f.score
FROM file_episodes fe JOIN files f ON f.id = fe.file_id JOIN versions v ON v.id = f.version_id WHERE v.title_id = ?;

-- name: SetSeriesMonitor :exec
UPDATE titles SET series_monitor = ? WHERE id = ? AND kind = 'series';

-- name: SetEpisodeMonitored :exec
UPDATE episodes SET monitored = ? WHERE id = ?;

-- name: SetSeasonEpisodesMonitored :exec
UPDATE episodes SET monitored = ? WHERE title_id = ? AND season = ?;

-- name: SetSeasonMonitored :exec
UPDATE seasons SET monitored = ? WHERE title_id = ? AND number = ?;

-- name: RefreshSeasonsMonitored :exec
UPDATE seasons SET monitored = EXISTS (
    SELECT 1 FROM episodes e WHERE e.title_id = seasons.title_id AND e.season = seasons.number AND e.monitored = 1
) WHERE seasons.title_id = ?;
