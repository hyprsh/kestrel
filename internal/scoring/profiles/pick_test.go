package profiles_test

import (
	"errors"
	"testing"

	"github.com/hyprsh/kestrel/internal/scoring/profiles"
)

func TestPickChecksAProfileNamedForAVersion(t *testing.T) {
	all := []profiles.Profile{
		{Key: "hd-primary", Enabled: true},
		{Key: "4k-primary", Enabled: false},
	}
	cases := []struct {
		key  string
		want error
	}{
		{"hd-primary", nil},
		{"nope", profiles.ErrNoSuchProfile},
		{"4k-primary", profiles.ErrDisabled},
	}
	for _, c := range cases {
		p, err := profiles.Pick(all, c.key)
		if !errors.Is(err, c.want) {
			t.Errorf("Pick(%q) = %v, want %v", c.key, err, c.want)
		}
		if c.want == nil && p.Key != c.key {
			t.Errorf("Pick(%q) returned %q", c.key, p.Key)
		}
	}
}
