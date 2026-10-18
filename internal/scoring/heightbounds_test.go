package scoring_test

import (
	"testing"

	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/slot"
)

func TestHeightBoundsAreTheSlotRange(t *testing.T) {
	cases := []struct {
		s      slot.Slot
		wide   bool
		lo, hi int
	}{
		{slot.Standard, false, 720, 1080},
		{slot.Standard, true, 0, 1080},
		{slot.FourK, false, 2160, 2160},
	}
	for _, c := range cases {
		lo, hi := scoring.HeightBounds(c.s, c.wide)
		if lo != c.lo || hi != c.hi || !c.s.Contains(lo, hi) {
			t.Errorf("%v wide=%v: %d-%d, want %d-%d inside the Slot", c.s, c.wide, lo, hi, c.lo, c.hi)
		}
	}
}
