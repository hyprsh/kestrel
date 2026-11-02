package slot_test

import (
	"testing"

	"github.com/hyprsh/kestrel/internal/slot"
)

func TestMatchLabel(t *testing.T) {
	set := []slot.Record{{ID: "standard", Label: "Original"}, {ID: "4k", Label: "4K"}, {ID: "german", Label: "German"}}
	aliases := map[slot.Slot][]string{"standard": {"Standard"}}
	cases := []struct {
		text string
		want slot.Slot
		ok   bool
	}{
		{"4K", "4k", true},
		{"4k", "4k", true},
		{"Original", "standard", true},
		{"standard", "standard", true},
		{"German", "german", true},
		{"Remux", "", false},
		{"", "", false},
	}
	for _, c := range cases {
		got, ok := slot.MatchLabel(set, aliases, c.text)
		if got != c.want || ok != c.ok {
			t.Errorf("%q: got %q %v, want %q %v", c.text, got, ok, c.want, c.ok)
		}
	}
}

func TestMatchLabelPrefersALabelOverAnAlias(t *testing.T) {
	set := []slot.Record{{ID: "a", Label: "Standard"}, {ID: "b", Label: "Other"}}
	aliases := map[slot.Slot][]string{"b": {"Standard"}}
	if got, _ := slot.MatchLabel(set, aliases, "standard"); got != "a" {
		t.Errorf("got %q, want a", got)
	}
}
