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

// labelOf is the label that names a Slot's files: the stored one, else the id.
// Without a store, which only tests leave out, it is the id.
func labelOf(ctx context.Context, src SlotLabels, id Slot) (string, error) {
	if src == nil {
		return slot.Label(nil, id), nil
	}
	all, err := src.List(ctx)
	if err != nil {
		return "", err
	}
	return slot.Label(all, id), nil
}
