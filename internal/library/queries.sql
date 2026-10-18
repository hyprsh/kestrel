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
INSERT INTO search_state (version_id, season, next_missing_at, next_upgrade_at, fresh) VALUES (?, ?, ?, ?, ?);

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

-- A misfit file (it fails its Profile's gates) does not hold its episodes: they are Wanted again, as a misfit Movie is.
-- name: ListFileEpisodes :many
SELECT f.version_id, fe.episode_id, f.score FROM file_episodes fe JOIN files f ON f.id = fe.file_id
WHERE f.id NOT IN (SELECT file_id FROM file_misfits);

-- name: ListFileEpisodesOfTitle :many
SELECT f.version_id, fe.episode_id, f.score
FROM file_episodes fe JOIN files f ON f.id = fe.file_id JOIN versions v ON v.id = f.version_id
WHERE v.title_id = ? AND f.id NOT IN (SELECT file_id FROM file_misfits);

-- name: ListAllFileEpisodesOfTitle :many
SELECT f.version_id, fe.episode_id
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

-- name: ListSearchStates :many
SELECT id, version_id, season, next_missing_at, last_missing_at, next_upgrade_at, last_upgrade_at, fresh FROM search_state ORDER BY id;

-- name: MarkSearchStateMissing :exec
UPDATE search_state SET last_missing_at = ?, next_missing_at = ? WHERE id = ?;

-- name: SetSearchStateNextUpgrade :exec
UPDATE search_state SET next_upgrade_at = ? WHERE id = ?;

-- name: SetSearchStateNextMissing :exec
UPDATE search_state SET next_missing_at = ? WHERE id = ?;

-- name: MarkUpgradeSearched :exec
UPDATE search_state SET last_upgrade_at = ?, next_upgrade_at = ? WHERE version_id = ?;

-- name: SetNextMissing :exec
UPDATE search_state SET next_missing_at = ? WHERE version_id = ?;

-- name: SetTitleFolder :exec
UPDATE titles SET folder = ? WHERE id = ? AND folder IS NULL;

-- name: ListFilesOfVersion :many
SELECT id, version_id, path, size, release_name, parsed_release, probe, score, grab_id, imported_at FROM files WHERE version_id = ?;

-- name: DeleteFile :exec
DELETE FROM files WHERE id = ?;

-- name: InsertFile :one
INSERT INTO files (version_id, path, size, release_name, parsed_release, probe, score, grab_id, imported_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
RETURNING id;

-- name: GetFileOfGrab :one
SELECT id, version_id, path, size, release_name, parsed_release, probe, score, grab_id, imported_at FROM files WHERE grab_id = ? LIMIT 1;

-- name: SetNextMissingSeason :exec
UPDATE search_state SET next_missing_at = ? WHERE version_id = ? AND season = ?;

-- name: FindTitleByKindTVDB :one
SELECT id FROM titles WHERE kind = ? AND tvdb_id = ?;

-- name: InsertFileEpisode :exec
INSERT INTO file_episodes (file_id, version_id, episode_id) VALUES (?, ?, ?);

-- name: GetFileOfVersionEpisode :one
SELECT file_id FROM file_episodes WHERE version_id = ? AND episode_id = ?;

-- name: DeleteFileEpisode :exec
DELETE FROM file_episodes WHERE version_id = ? AND episode_id = ?;

-- name: CountFileEpisodes :one
SELECT COUNT(*) FROM file_episodes WHERE file_id = ?;

-- name: GetFile :one
SELECT id, version_id, path, size, release_name, parsed_release, probe, score, grab_id, imported_at FROM files WHERE id = ?;

-- name: ListFilesOfGrab :many
SELECT id, version_id, path, size, release_name, parsed_release, probe, score, grab_id, imported_at FROM files WHERE grab_id = ? ORDER BY id;

-- name: ListMisfitFileIDs :many
SELECT file_id FROM file_misfits;

-- name: ClearMisfit :exec
DELETE FROM file_misfits WHERE file_id = ?;

-- name: SetMisfit :exec
INSERT OR IGNORE INTO file_misfits (file_id) VALUES (?);

-- name: SetReplacedScore :exec
INSERT OR REPLACE INTO file_replaced_scores (file_id, score) VALUES (?, ?);

-- name: SetFileScore :exec
UPDATE files SET score = ? WHERE id = ?;

-- name: SetVersionProfile :exec
UPDATE versions SET profile_key = ? WHERE id = ?;

-- name: GetVersion :one
SELECT id, title_id, slot, profile_key, added_at FROM versions WHERE id = ?;

-- name: DeleteVersion :exec
DELETE FROM versions WHERE id = ?;

-- name: DeleteTitle :exec
DELETE FROM titles WHERE id = ?;

-- name: SetNextSearchesAll :exec
UPDATE search_state SET next_missing_at = ?, next_upgrade_at = ? WHERE version_id = ?;

-- name: ListRefreshable :many
SELECT id, kind, tmdb_id, tvdb_id, refreshed_at FROM titles WHERE metadata_frozen = 0 ORDER BY id;

-- name: SetMetadataFrozen :exec
UPDATE titles SET metadata_frozen = ? WHERE id = ?;

-- name: UpdateTitleMetadata :exec
UPDATE titles SET title = ?, original_title = ?, primary_title = ?, year = ?,
    original_language = ?, overview = ?, runtime = ?, poster_path = ?, refreshed_at = ?
WHERE id = ?;

-- name: DeleteAliasesOfTitle :exec
DELETE FROM title_aliases WHERE title_id = ?;

-- name: DeleteReleaseDatesOfTitle :exec
DELETE FROM title_release_dates WHERE title_id = ?;

-- name: UpdateEpisode :exec
UPDATE episodes SET season = ?, number = ?, tvdb_id = ?, name = ?, air_date = ? WHERE id = ?;

-- name: ParkEpisodeNumber :exec
UPDATE episodes SET number = -id WHERE id = ?;

-- name: ListSeasonNumbers :many
SELECT number FROM seasons WHERE title_id = ?;

-- name: ListFilesWithSlot :many
SELECT f.id, f.version_id, v.slot, f.path, f.parsed_release, f.probe
FROM files f JOIN versions v ON v.id = f.version_id WHERE v.title_id = ? ORDER BY f.id;

-- name: ListFileEpisodeRefs :many
SELECT fe.file_id, e.season, e.number
FROM file_episodes fe JOIN episodes e ON e.id = fe.episode_id JOIN files f ON f.id = fe.file_id JOIN versions v ON v.id = f.version_id
WHERE v.title_id = ? ORDER BY e.season, e.number;

-- name: SetFilePath :exec
UPDATE files SET path = ? WHERE id = ?;

-- name: ForceTitleFolder :exec
UPDATE titles SET folder = ? WHERE id = ?;

-- name: ListEpisodesAiring :many
SELECT e.id, e.title_id, e.season, e.number, e.name, e.air_date
FROM episodes e JOIN titles t ON t.id = e.title_id
WHERE t.monitored = 1 AND e.monitored = 1 AND e.air_date >= ? AND e.air_date <= ?
ORDER BY e.air_date, e.title_id, e.season, e.number;

-- name: ListRecentFiles :many
SELECT f.id, f.version_id, v.title_id, v.slot, f.release_name, f.score, f.grab_id, f.imported_at, COALESCE(g.is_upgrade, 0) AS is_upgrade, r.score AS replaced_score
FROM files f JOIN versions v ON v.id = f.version_id LEFT JOIN grabs g ON g.id = f.grab_id LEFT JOIN file_replaced_scores r ON r.file_id = f.id
WHERE f.grab_id IS NOT NULL
ORDER BY f.imported_at DESC, f.id DESC LIMIT ?;
