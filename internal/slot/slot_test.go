package slot_test

import (
	"testing"

	"github.com/hyprsh/kestrel/internal/resolution"
	"github.com/hyprsh/kestrel/internal/slot"
)

func TestSlotNames(t *testing.T) {
	cases := []struct {
		s          slot.Slot
		key, name  string
		minH, maxH int
	}{
		{slot.Standard, "standard", "Standard", 0, 1080},
		{slot.FourK, "4k", "4K", 2160, 2160},
	}
	for _, c := range cases {
		if c.s.Key() != c.key || c.s.Name() != c.name || c.s.Label() != c.name {
			t.Errorf("%v: key %q name %q label %q", c.s, c.s.Key(), c.s.Name(), c.s.Label())
		}
		if lo, hi := c.s.Range(); lo != c.minH || hi != c.maxH {
			t.Errorf("%v range %d-%d", c.s, lo, hi)
		}
		got, ok := slot.Parse(c.key)
		if !ok || got != c.s {
			t.Errorf("Parse(%q) = %v, %v", c.key, got, ok)
		}
	}
}

func TestParseRejectsTheOldSlots(t *testing.T) {
	for _, k := range []string{"sd", "hd", "uhd", "", "Standard", "4K"} {
		if _, ok := slot.Parse(k); ok {
			t.Errorf("Parse(%q) accepted", k)
		}
	}
}

func TestContains(t *testing.T) {
	if !slot.Standard.Contains(720, 1080) || !slot.Standard.Contains(0, 1080) || slot.Standard.Contains(0, 2160) {
		t.Error("standard bounds")
	}
	if !slot.FourK.Contains(2160, 2160) || slot.FourK.Contains(1080, 2160) {
		t.Error("4k bounds")
	}
}

func TestOfClass(t *testing.T) {
	if slot.OfClass(resolution.UHD) != slot.FourK || slot.OfClass(resolution.HD) != slot.Standard || slot.OfClass(resolution.SD) != slot.Standard {
		t.Error("class mapping")
	}
}

func TestOrder(t *testing.T) {
	if len(slot.All) != slot.Count || slot.All[0] != slot.Standard || slot.All[1] != slot.FourK {
		t.Error("order")
	}
}
