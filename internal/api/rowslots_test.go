package api

import (
	"testing"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/slot"
)

func TestRowToAPIListsSlotStatesInSlotOrder(t *testing.T) {
	r := library.Row{Slots: map[slot.Slot]*library.SlotState{}}
	r.Slots[slot.FourK] = &library.SlotState{VersionID: 2, Profile: "4k-primary", State: library.Wanted, LongMissing: true}
	r.Slots[slot.Standard] = &library.SlotState{VersionID: 1, Profile: "hd-primary", State: library.Filled}
	have, aired := 56, 62
	r.Slots[slot.Standard].EpisodesHave, r.Slots[slot.Standard].EpisodesAired = &have, &aired
	got := rowToAPI(r).SlotStates
	if got[0].EpisodesHave == nil || *got[0].EpisodesHave != 56 || *got[0].EpisodesAired != 62 || got[1].EpisodesHave != nil {
		t.Errorf("episode counts = %+v", got)
	}
	if len(got) != 2 || got[0].Slot != "standard" || got[0].Label != "Standard" || got[0].State != "filled" || got[0].VersionId != 1 ||
		got[1].Slot != "4k" || got[1].Label != "4K" || got[1].State != "wanted" || !got[1].LongMissing || got[1].Profile != "4k-primary" {
		t.Errorf("slot_states = %+v", got)
	}
}

func TestRowToAPISlotStatesOmitsSlotsWithoutAVersion(t *testing.T) {
	r := library.Row{Slots: map[slot.Slot]*library.SlotState{}}
	r.Slots[slot.FourK] = &library.SlotState{VersionID: 2, State: library.Filled}
	got := rowToAPI(r)
	if len(got.SlotStates) != 1 || got.SlotStates[0].Slot != "4k" {
		t.Errorf("slot_states = %+v", got.SlotStates)
	}
	if empty := rowToAPI(library.Row{}).SlotStates; empty == nil || len(empty) != 0 {
		t.Errorf("a Title with no Version has an empty list, got %#v", empty)
	}
}
