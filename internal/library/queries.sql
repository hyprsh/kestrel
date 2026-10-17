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
