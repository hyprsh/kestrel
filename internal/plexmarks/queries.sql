-- name: ListMarks :many
SELECT * FROM plex_marks ORDER BY title_id;

-- name: InsertMark :exec
INSERT INTO plex_marks (title_id, instance_id, section_key, item_id, item_kind) VALUES (?, ?, ?, ?, ?);

-- name: SetMarkLabels :exec
UPDATE plex_marks SET labels = ?, labelled_at = ? WHERE title_id = ?;

-- name: SetMarkBadge :exec
UPDATE plex_marks SET badge_at = ?, badge_until = ?, original_poster = ?, badge_poster = ? WHERE title_id = ?;

-- name: DeleteMark :exec
DELETE FROM plex_marks WHERE title_id = ?;
