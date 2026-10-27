-- name: GetHistoryPosition :one
SELECT viewed_at FROM plex_history_position WHERE instance_id = ?;

-- name: SetHistoryPosition :exec
INSERT INTO plex_history_position (instance_id, viewed_at) VALUES (?, ?)
ON CONFLICT (instance_id) DO UPDATE SET viewed_at = excluded.viewed_at;

-- name: GetShow :one
SELECT tvdb_id FROM plex_shows WHERE instance_id = ? AND show_key = ?;

-- name: SetShow :exec
INSERT INTO plex_shows (instance_id, show_key, tvdb_id, resolved_at) VALUES (?, ?, ?, ?)
ON CONFLICT (instance_id, show_key) DO UPDATE SET tvdb_id = excluded.tvdb_id, resolved_at = excluded.resolved_at;

-- name: InsertPlay :exec
INSERT OR IGNORE INTO watch_ahead_plays (tvdb_id, season, episode, first_seen_at) VALUES (?, ?, ?, ?);

-- name: CountPlayedEpisodes :one
SELECT count(*) FROM watch_ahead_plays WHERE tvdb_id = ? AND season = ?;
