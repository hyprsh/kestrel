-- name: ListProfiles :many
SELECT key, name, sort, any, release_family, language_rule, min_height, max_height, enabled, original_fallback,
       trash_profile_movies, trash_profile_series, original_language,
       custom, series_qualities, movie_qualities, series_cutoff, movie_cutoff, upgrade_until, min_score,
       movie_min_size, movie_max_size, episode_min_size, episode_max_size
FROM profiles ORDER BY sort;

-- name: SetProfileEnabled :exec
UPDATE profiles SET enabled = ? WHERE key = ?;

-- name: SetProfileOriginalChoice :exec
-- original_fallback is kept in step for older readers (scoring.OriginalChoice.DeprecatedFlag).
UPDATE profiles SET original_language = ?, original_fallback = ? WHERE key = ?;

-- The Slots that name the Profile as their default for either kind, in order (ADR 0024).
-- name: SlotsDefaulting :many
SELECT id, label FROM slots WHERE default_movies = ?1 OR default_series = ?1 ORDER BY position;

-- name: SetProfileTrash :exec
UPDATE profiles SET trash_profile_movies = ?, trash_profile_series = ? WHERE key = ?;

-- name: SetProfileRecipe :exec
-- The Release Family and language rule of a Profile (ADR 0026); the caller sets its backing profiles with SetProfileTrash.
UPDATE profiles SET release_family = ?, language_rule = ? WHERE key = ?;

-- name: SetProfileOverlay :exec
-- What the household set on top of TRaSH (ADR 0023); NULL is as TRaSH has it, or no limit.
UPDATE profiles SET series_qualities = ?, movie_qualities = ?, series_cutoff = ?, movie_cutoff = ?, upgrade_until = ?,
    min_score = ?, movie_min_size = ?, movie_max_size = ?, episode_min_size = ?, episode_max_size = ?
WHERE key = ?;

-- name: SetProfileName :exec
UPDATE profiles SET name = ? WHERE key = ?;

-- name: InsertCustomProfile :exec
INSERT INTO profiles (key, name, sort, any, release_family, language_rule, min_height, max_height, enabled, original_fallback,
    trash_profile_movies, trash_profile_series, original_language, custom,
    series_qualities, movie_qualities, series_cutoff, movie_cutoff, upgrade_until, min_score,
    movie_min_size, movie_max_size, episode_min_size, episode_max_size)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);

-- name: DeleteCustomProfile :execrows
DELETE FROM profiles WHERE key = ? AND custom = 1;

-- name: VersionsUnderProfile :many
SELECT v.id AS version_id, v.title_id FROM versions v WHERE v.profile_key = ? ORDER BY v.id;

-- name: ProfileVersionCount :one
SELECT COUNT(*) FROM versions WHERE profile_key = ?;

-- name: MaxProfileSort :one
SELECT COALESCE(MAX(sort), 0) FROM profiles;

-- The files that fit their Version, with what the cutoff looks at: the Profile, the kind, the Score and the stored parse, and the episodes a file holds.
-- name: CutoffFiles :many
SELECT v.profile_key, t.kind, f.version_id, f.score, f.parsed_release,
       (SELECT COUNT(*) FROM file_episodes fe WHERE fe.file_id = f.id) AS episodes
FROM files f
JOIN versions v ON v.id = f.version_id
JOIN titles t ON t.id = v.title_id
LEFT JOIN file_misfits m ON m.file_id = f.id
WHERE m.file_id IS NULL;

-- What BelowCutoff's answer depends on in the library, as a few aggregates: files (how many, which, their Scores and stored parses),
-- misfits and the episodes files hold. A change of any of them changes the row.
-- name: CutoffInputs :one
SELECT CAST((SELECT COUNT(*) FROM files) AS INTEGER) AS files,
       CAST((SELECT COALESCE(SUM(id), 0) FROM files) AS INTEGER) AS file_ids,
       CAST((SELECT COALESCE(SUM(COALESCE(score, 0)), 0) FROM files) AS INTEGER) AS scores,
       CAST((SELECT COALESCE(SUM(LENGTH(COALESCE(parsed_release, ''))), 0) FROM files) AS INTEGER) AS parses,
       CAST((SELECT COUNT(*) FROM file_misfits) AS INTEGER) AS misfits,
       CAST((SELECT COALESCE(SUM(file_id), 0) FROM file_misfits) AS INTEGER) AS misfit_ids,
       CAST((SELECT COUNT(*) FROM file_episodes) AS INTEGER) AS file_episodes;

-- name: VersionProfileKeys :many
SELECT id, profile_key FROM versions ORDER BY id;
