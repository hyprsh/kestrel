package scoring_test

import (
	"testing"

	"github.com/hyprsh/kestrel/internal/scoring"
)

func TestHeightBoundsFollowTheKindOfProfile(t *testing.T) {
	cases := []struct {
		name      string
		uhd, wide bool
		lo, hi    int
	}{
		{"HD", false, false, 720, 1080},
		{"Any", false, true, 0, 1080},
		{"4K", true, false, 2160, 2160},
	}
	for _, c := range cases {
		lo, hi := scoring.HeightBounds(c.uhd, c.wide)
		if lo != c.lo || hi != c.hi {
			t.Errorf("%s: %d-%d, want %d-%d", c.name, lo, hi, c.lo, c.hi)
		}
	}
}
