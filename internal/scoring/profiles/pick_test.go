package profiles_test

import (
	"errors"
	"testing"

	"github.com/hyprsh/kestrel/internal/resolution"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
)

func TestPickChecksAProfileNamedForASlot(t *testing.T) {
	all := []profiles.Profile{
		{Key: "hd-primary", Slot: resolution.HD, Enabled: true},
		{Key: "uhd-primary", Slot: resolution.UHD, Enabled: false},
	}
	cases := []struct {
		key  string
		slot resolution.Class
		want error
	}{
		{"hd-primary", resolution.HD, nil},
		{"nope", resolution.HD, profiles.ErrNoSuchProfile},
		{"hd-primary", resolution.UHD, profiles.ErrWrongSlot},
		{"uhd-primary", resolution.UHD, profiles.ErrDisabled},
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
