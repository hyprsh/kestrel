package library

import (
	"context"

	"github.com/hyprsh/kestrel/internal/library/db"
)

// A file carries two marks, each a row in its own table: misfit (it fails its
// Version's Profile, see File.Misfit) and Original (an accepted Original
// Offer, see File.Original).

// misfitSet is the ids of the misfit files.
func misfitSet(ctx context.Context, q *db.Queries) (map[int64]bool, error) {
	return idSet(q.ListMisfitFileIDs(ctx))
}

// originalSet is the ids of the files that are Originals.
func originalSet(ctx context.Context, q *db.Queries) (map[int64]bool, error) {
	return idSet(q.ListOriginalFileIDs(ctx))
}

func idSet(ids []int64, err error) (map[int64]bool, error) {
	if err != nil {
		return nil, err
	}
	out := make(map[int64]bool, len(ids))
	for _, id := range ids {
		out[id] = true
	}
	return out, nil
}

// markFile flags or clears a file's misfit and Original marks.
func markFile(ctx context.Context, q *db.Queries, fileID int64, misfit, original bool) error {
	for _, m := range []struct {
		on         bool
		set, clear func(context.Context, int64) error
	}{
		{misfit, q.SetMisfit, q.ClearMisfit},
		{original, q.SetOriginal, q.ClearOriginal},
	} {
		do := m.clear
		if m.on {
			do = m.set
		}
		if err := do(ctx, fileID); err != nil {
			return err
		}
	}
	return nil
}
