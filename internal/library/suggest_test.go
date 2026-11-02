package library_test

import (
	"testing"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
	"github.com/hyprsh/kestrel/internal/slot"
)

// seededSlots are the two Slots a library starts with: Standard on for new Titles, 4K off.
func seededSlots() []slot.Record {
	return []slot.Record{
		{ID: "standard", Label: "Standard", DefaultMovies: "hd-primary", DefaultSeries: "hd-primary", OnForNew: true},
		{ID: "4k", Label: "4K", DefaultMovies: "4k-primary", DefaultSeries: "4k-primary", Position: 1},
	}
}

func TestOnlySlotsOnForNewTitlesArePreselected(t *testing.T) {
	s := library.Suggest(profiles.Builtin(), seededSlots(), library.Movie)
	if len(s.Slots) != 1 || s.Slots[0].Slot != slot.Standard || s.Slots[0].Profile.Key != "hd-primary" || s.Slots[0].Reason != library.ReasonDefault {
		t.Fatalf("suggestion = %+v", s)
	}

	both := seededSlots()
	both[1].OnForNew = true
	var got []string
	for _, sl := range library.Suggest(profiles.Builtin(), both, library.Movie).Slots {
		got = append(got, sl.Slot.Key()+":"+sl.Profile.Key)
	}
	if len(got) != 2 || got[0] != "standard:hd-primary" || got[1] != "4k:4k-primary" {
		t.Errorf("slots = %v, want every Slot that is on, in Slot order", got)
	}
}

func TestDefaultsAreReadPerKindAndAnySlotCanTakeAnyProfile(t *testing.T) {
	slots := seededSlots()
	slots[1].OnForNew = true
	slots[1].DefaultMovies = "hd-original" // a 4K-named Slot may default to a Standard-range Profile
	slots[1].DefaultSeries = ""
	if s := library.Suggest(profiles.Builtin(), slots, library.Movie); len(s.Slots) != 2 || s.Slots[1].Profile.Key != "hd-original" {
		t.Errorf("Movie defaults = %+v", s.Slots)
	}
	if s := library.Suggest(profiles.Builtin(), slots, library.Series); len(s.Slots) != 1 {
		t.Errorf("a Slot with no Series default preselected for a Series: %+v", s.Slots)
	}
}

func TestADisabledDefaultLeavesTheSlotOut(t *testing.T) {
	all := profiles.Builtin()
	for i := range all {
		if all[i].Key == "hd-primary" {
			all[i].Enabled = false
		}
	}
	if s := library.Suggest(all, seededSlots(), library.Movie); len(s.Slots) != 0 {
		t.Errorf("suggestion = %+v", s.Slots)
	}
}

func TestAnAnyDefaultIsSuggestedByItsName(t *testing.T) {
	slots := seededSlots()
	slots[0].DefaultMovies = "any-primary"
	s := library.Suggest(profiles.Builtin(), slots, library.Movie)
	if got := s.Slots[0]; got.Profile.Key != "any-primary" || got.Label != "Any" {
		t.Errorf("got %s %q, want any-primary Any", got.Profile.Key, got.Label)
	}
}
