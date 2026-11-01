package imports

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/hyprsh/kestrel/internal/release"
)

// BackfillMedia gives the files stored before the parser read the video codec,
// HDR format and audio format those facts, by parsing the stored release name
// again. It runs at startup: a file whose name states none of them is looked at
// again on the next start, which costs one parse of a name. It returns how many
// files it updated.
func BackfillMedia(ctx context.Context, db *sql.DB) (int, error) {
	rows, err := db.QueryContext(ctx, `SELECT id, release_name FROM files
		WHERE parsed_release IS NOT NULL AND json_valid(parsed_release)
		AND json_type(parsed_release, '$.videoCodec') IS NULL AND json_type(parsed_release, '$.hdr') IS NULL
		AND json_type(parsed_release, '$.audioCodec') IS NULL AND json_type(parsed_release, '$.audioChannels') IS NULL`)
	if err != nil {
		return 0, fmt.Errorf("backfill media facts: %w", err)
	}
	type fact struct {
		id   int64
		args []any
		set  string
	}
	var todo []fact
	for rows.Next() {
		var id int64
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			rows.Close()
			return 0, fmt.Errorf("backfill media facts: %w", err)
		}
		v, h, a, c := release.ParseMedia(name)
		var sets []string
		var args []any
		for _, kv := range [][2]string{{"videoCodec", v}, {"hdr", h}, {"audioCodec", a}, {"audioChannels", c}} {
			if kv[1] != "" {
				sets = append(sets, "'$."+kv[0]+"', ?")
				args = append(args, kv[1])
			}
		}
		if len(sets) > 0 {
			todo = append(todo, fact{id, args, strings.Join(sets, ", ")})
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, fmt.Errorf("backfill media facts: %w", err)
	}
	rows.Close()
	for _, f := range todo {
		if _, err := db.ExecContext(ctx, `UPDATE files SET parsed_release = json_set(parsed_release, `+f.set+`) WHERE id = ?`, append(f.args, f.id)...); err != nil {
			return 0, fmt.Errorf("backfill media facts: %w", err)
		}
	}
	return len(todo), nil
}
