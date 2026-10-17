package profiles

import (
	"errors"
	"testing"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/resolution"
)

// set builds the eight Profiles with the given keys enabled and defaults
// {kind: {slot: key}}.
func set(enabled []string, movies, series map[resolution.Class]string) []Profile {
	on := map[string]bool{}
	for _, k := range enabled {
		on[k] = true
	}
	var out []Profile
	for _, p := range Builtin() {
		p.Enabled = on[p.Key]
		p.DefaultMovies = movies[p.Slot] == p.Key
		p.DefaultSeries = series[p.Slot] == p.Key
		out = append(out, p)
	}
	return out
}

var allKeys = []string{"sd-primary", "sd-original", "hd-primary", "hd-original", "kids-primary", "kids-original", "uhd-primary", "uhd-original"}

func TestResolve(t *testing.T) {
	hdDefault := map[resolution.Class]string{resolution.HD: "hd-primary"}
	cases := []struct {
		name     string
		profiles []Profile
		kind     release.Kind
		slot     resolution.Class
		kids     bool
		want     string
		swapped  bool
		err      error
	}{
		{"slot default for movies", set(allKeys, hdDefault, hdDefault), release.KindMovie, resolution.HD, false, "hd-primary", false, nil},
		{"default differs per kind", set(allKeys, map[resolution.Class]string{resolution.HD: "hd-primary"}, map[resolution.Class]string{resolution.HD: "hd-original"}), release.KindSeries, resolution.HD, false, "hd-original", false, nil},
		{"configured UHD default", set(allKeys, map[resolution.Class]string{resolution.HD: "hd-primary", resolution.UHD: "uhd-original"}, hdDefault), release.KindMovie, resolution.UHD, false, "uhd-original", false, nil},
		{"no default falls to enabled Primary-Language Profile", set(allKeys, hdDefault, hdDefault), release.KindMovie, resolution.UHD, false, "uhd-primary", false, nil},
		{"no default and Primary disabled falls to Original", set([]string{"hd-primary", "uhd-original"}, hdDefault, hdDefault), release.KindMovie, resolution.UHD, false, "uhd-original", false, nil},
		{"SD with nothing enabled in the Slot", set([]string{"hd-primary"}, hdDefault, hdDefault), release.KindMovie, resolution.SD, false, "", false, ErrNoEnabledProfile},
		{"nothing enabled at all", set(nil, nil, nil), release.KindMovie, resolution.HD, false, "", false, ErrNoEnabledProfile},
		{"Kids swaps hd-primary", set(allKeys, hdDefault, hdDefault), release.KindMovie, resolution.HD, true, "kids-primary", true, nil},
		{"Kids swaps hd-original", set(allKeys, map[resolution.Class]string{resolution.HD: "hd-original"}, hdDefault), release.KindMovie, resolution.HD, true, "kids-original", true, nil},
		{"Kids swap needs the Kids Profile enabled", set([]string{"hd-primary", "kids-original"}, hdDefault, hdDefault), release.KindMovie, resolution.HD, true, "hd-primary", false, nil},
		{"Kids does not touch UHD", set(allKeys, map[resolution.Class]string{resolution.HD: "hd-primary", resolution.UHD: "uhd-primary"}, hdDefault), release.KindMovie, resolution.UHD, true, "uhd-primary", false, nil},
		{"Kids does not touch SD", set(allKeys, map[resolution.Class]string{resolution.HD: "hd-primary", resolution.SD: "sd-primary"}, hdDefault), release.KindMovie, resolution.SD, true, "sd-primary", false, nil},
		{"Kids swap also applies to a fallen-back HD Profile", set([]string{"hd-original", "kids-original"}, nil, nil), release.KindMovie, resolution.HD, true, "kids-original", true, nil},
		{"a Kids default stays Kids", set(allKeys, map[resolution.Class]string{resolution.HD: "kids-primary"}, hdDefault), release.KindMovie, resolution.HD, false, "kids-primary", false, nil},
	}
	for _, c := range cases {
		got, err := Resolve(c.profiles, c.kind, c.slot, c.kids)
		if !errors.Is(err, c.err) {
			t.Errorf("%s: err = %v, want %v", c.name, err, c.err)
			continue
		}
		if got.Key != c.want || got.KidsSwap != c.swapped {
			t.Errorf("%s: got %q (swap %v), want %q (swap %v)", c.name, got.Key, got.KidsSwap, c.want, c.swapped)
		}
	}
}
