-- name: ListProfiles :many
SELECT key, name, sort, slot, any, language_rule, min_height, max_height, enabled, original_fallback,
       default_movies, default_series, trash_profile_movies, trash_profile_series, original_language
FROM profiles ORDER BY sort;

-- name: SetProfileEnabled :exec
UPDATE profiles SET enabled = ?1, default_movies = CASE WHEN ?1 = 0 THEN 0 ELSE default_movies END,
    default_series = CASE WHEN ?1 = 0 THEN 0 ELSE default_series END
WHERE key = ?2;

-- name: SetProfileOriginalLanguage :exec
-- original_fallback is kept in step for older readers: 1 only for accept.
UPDATE profiles SET original_language = ?1, original_fallback = CASE WHEN ?1 = 'accept' THEN 1 ELSE 0 END
WHERE key = ?2;

-- name: ClearSlotDefaultMovies :exec
UPDATE profiles SET default_movies = 0 WHERE slot = ?;

-- name: ClearSlotDefaultSeries :exec
UPDATE profiles SET default_series = 0 WHERE slot = ?;

-- name: SetProfileDefaultMovies :exec
UPDATE profiles SET default_movies = ? WHERE key = ?;

-- name: SetProfileDefaultSeries :exec
UPDATE profiles SET default_series = ? WHERE key = ?;

-- name: SetProfileTrash :exec
UPDATE profiles SET trash_profile_movies = ?, trash_profile_series = ? WHERE key = ?;
