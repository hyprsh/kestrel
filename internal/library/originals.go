package library

import (
	"context"

	"github.com/hyprsh/kestrel/internal/library/db"
)

// originalSet is the ids of the files that are Originals (see File).
func originalSet(ctx context.Context, q *db.Queries) (map[int64]bool, error) {
	ids, err := q.ListOriginalFileIDs(ctx)
	if err != nil {
		return nil, err
	}
	out := make(map[int64]bool, len(ids))
	for _, id := range ids {
		out[id] = true
	}
	return out, nil
}

// markOriginal flags or clears a file's Original mark.
func markOriginal(ctx context.Context, q *db.Queries, fileID int64, on bool) error {
	if on {
		return q.SetOriginal(ctx, fileID)
	}
	return q.ClearOriginal(ctx, fileID)
}
