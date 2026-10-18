package profiles_test

import (
	"errors"
	"github.com/hyprsh/kestrel/internal/slot"
	"testing"

	"github.com/hyprsh/kestrel/internal/scoring/profiles"
)

func TestPickChecksAProfileNamedForASlot(t *testing.T) {
	all := []profiles.Profile{
		{Key: "hd-primary", Slot: slot.Standard, Enabled: true},
		{Key: "4k-primary", Slot: slot.FourK, Enabled: false},
	}
	cases := []struct {
		key  string
		slot slot.Slot
		want error
	}{
		{"hd-primary", slot.Standard, nil},
		{"nope", slot.Standard, profiles.ErrNoSuchProfile},
		{"hd-primary", slot.FourK, profiles.ErrWrongSlot},
		{"4k-primary", slot.FourK, profiles.ErrDisabled},
	}
	for _, c := range cases {
		p, err := profiles.Pick(all, c.key, c.slot)
		if !errors.Is(err, c.want) {
			t.Errorf("Pick(%q, %v) = %v, want %v", c.key, c.slot, err, c.want)
		}
		if c.want == nil && p.Key != c.key {
			t.Errorf("Pick(%q) returned %q", c.key, p.Key)
		}
	}
}
