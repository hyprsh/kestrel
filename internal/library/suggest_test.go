package library_test

import (
	"github.com/hyprsh/kestrel/internal/slot"
	"testing"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
)

func profilesWith(edit func(map[string]*profiles.Profile)) []profiles.Profile {
	all := profiles.Builtin()
	m := map[string]*profiles.Profile{}
	for i := range all {
		m[all[i].Key] = &all[i]
	}
	if edit != nil {
		edit(m)
	}
	return all
}

func TestOnlySlotsWithADefaultArePreselected(t *testing.T) {
	s := library.Suggest(profilesWith(nil), slot.All, library.Movie)
	if len(s.Slots) != 1 || s.Slots[0].Slot != slot.Standard || s.Slots[0].Profile.Key != "hd-primary" || s.Slots[0].Reason != library.ReasonDefault {
		t.Fatalf("suggestion = %+v", s)
	}

	s = library.Suggest(profilesWith(func(m map[string]*profiles.Profile) {
		m["4k-primary"].DefaultMovies = true
	}), slot.All, library.Movie)
	var got []string
	for _, sl := range s.Slots {
		got = append(got, sl.Slot.String()+":"+sl.Profile.Key)
	}
	if len(got) != 2 || got[0] != "Standard:hd-primary" || got[1] != "4K:4k-primary" {
		t.Errorf("slots = %v, want every Slot with a default, in Slot order", got)
	}
}

func TestDefaultsAreReadPerKind(t *testing.T) {
	all := profilesWith(func(m map[string]*profiles.Profile) { m["4k-primary"].DefaultSeries = true })
	if s := library.Suggest(all, slot.All, library.Movie); len(s.Slots) != 1 {
		t.Errorf("a Series-only 4K default preselected for a Movie: %+v", s.Slots)
	}
	if s := library.Suggest(all, slot.All, library.Series); len(s.Slots) != 2 {
		t.Errorf("Series defaults = %+v", s.Slots)
	}
}

func TestARatedForChildrenTitleStillGetsTheSlotDefault(t *testing.T) {
	s := library.Suggest(profilesWith(nil), slot.All, library.Movie)
	if len(s.Slots) != 1 {
		t.Fatalf("slots = %+v", s.Slots)
	}
	got := s.Slots[0]
	if got.Profile.Key != "hd-primary" || got.Label != "HD" || got.Reason != library.ReasonDefault {
		t.Errorf("got %s %q %v, want hd-primary %q default", got.Profile.Key, got.Label, got.Reason, "HD")
	}
}

func TestAnAnyDefaultIsSuggestedByItsName(t *testing.T) {
	all := profilesWith(func(m map[string]*profiles.Profile) {
		m["hd-primary"].DefaultMovies = false
		m["any-primary"].DefaultMovies = true
	})
	s := library.Suggest(all, slot.All, library.Movie)
	if got := s.Slots[0]; got.Profile.Key != "any-primary" || got.Label != "Any" {
		t.Errorf("got %s %q, want any-primary Any", got.Profile.Key, got.Label)
	}
}

func TestSuggestFollowsTheGivenSlotOrderIncludingAdminDefinedSlots(t *testing.T) {
	all := profilesWith(nil)
	kids := all[0]
	kids.Key, kids.Slot, kids.DefaultMovies = "kids-primary", "kids", true
	all = append(all, kids)
	order := []slot.Slot{"kids", slot.Standard, slot.FourK}
	s := library.Suggest(all, order, library.Movie)
	if len(s.Slots) != 2 || s.Slots[0].Slot != "kids" || s.Slots[1].Slot != slot.Standard {
		t.Errorf("suggestion = %+v, want kids then standard", s.Slots)
	}
}
