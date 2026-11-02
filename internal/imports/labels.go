package imports

import (
	"context"

	"github.com/hyprsh/kestrel/internal/slot"
)

// SlotLabels is where the Slots' current labels are stored (ADR 0024).
// *slots.Service satisfies it.
type SlotLabels interface {
	List(ctx context.Context) ([]slot.Record, error)
	// TitleIDs are the Titles with a Version in the Slot.
	TitleIDs(ctx context.Context, id slot.Slot) ([]int64, error)
}

// labelOf is the label that names a Slot's files: the stored one. Without a
// store, which only tests leave out, it is the seeded name of the two Slots
// Kestrel starts with, else the id.
func labelOf(ctx context.Context, src SlotLabels, id Slot) (string, error) {
	if src == nil {
		return id.Name(), nil
	}
	all, err := src.List(ctx)
	if err != nil {
		return "", err
	}
	for _, r := range all {
		if r.ID == id {
			return r.Label, nil
		}
	}
	return id.Name(), nil
}
