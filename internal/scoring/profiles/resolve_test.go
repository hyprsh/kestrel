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

var allKeys = []string{"sd-primary", "sd-original", "hd-primary", "hd-original", "any-primary", "any-original", "uhd-primary", "uhd-original"}

func TestResolve(t *testing.T) {
	hdDefault := map[resolution.Class]string{resolution.HD: "hd-primary"}
	cases := []struct {
		name     string
		profiles []Profile
		kind     release.Kind
		slot     resolution.Class
		want     string
		err      error
	}{
		{"slot default for movies", set(allKeys, hdDefault, hdDefault), release.KindMovie, resolution.HD, "hd-primary", nil},
		{"default differs per kind", set(allKeys, map[resolution.Class]string{resolution.HD: "hd-primary"}, map[resolution.Class]string{resolution.HD: "hd-original"}), release.KindSeries, resolution.HD, "hd-original", nil},
		{"configured UHD default", set(allKeys, map[resolution.Class]string{resolution.HD: "hd-primary", resolution.UHD: "uhd-original"}, hdDefault), release.KindMovie, resolution.UHD, "uhd-original", nil},
		{"no default falls to enabled Primary-Language Profile", set(allKeys, hdDefault, hdDefault), release.KindMovie, resolution.UHD, "uhd-primary", nil},
		{"no default and Primary disabled falls to Original", set([]string{"hd-primary", "uhd-original"}, hdDefault, hdDefault), release.KindMovie, resolution.UHD, "uhd-original", nil},
		{"SD with nothing enabled in the Slot", set([]string{"hd-primary"}, hdDefault, hdDefault), release.KindMovie, resolution.SD, "", ErrNoEnabledProfile},
		{"nothing enabled at all", set(nil, nil, nil), release.KindMovie, resolution.HD, "", ErrNoEnabledProfile},
		{"an Any default is picked like any other", set(allKeys, map[resolution.Class]string{resolution.HD: "any-primary"}, hdDefault), release.KindMovie, resolution.HD, "any-primary", nil},
		{"Any is never a fallback", set([]string{"any-primary", "any-original"}, nil, nil), release.KindMovie, resolution.HD, "", ErrNoEnabledProfile},
	}
	for _, c := range cases {
		got, err := Resolve(c.profiles, c.kind, c.slot)
		if !errors.Is(err, c.err) {
			t.Errorf("%s: err = %v, want %v", c.name, err, c.err)
			continue
		}
		if got.Key != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got.Key, c.want)
		}
	}
}

func TestResolveAcceptingFallsToAnyOfTheSameLanguageRule(t *testing.T) {
	hdDefault := map[resolution.Class]string{resolution.HD: "hd-primary"}
	only := func(keys ...string) func(Profile) bool {
		return func(p Profile) bool {
			for _, k := range keys {
				if p.Key == k {
					return true
				}
			}
			return false
		}
	}
	cases := []struct {
		name     string
		profiles []Profile
		accepts  func(Profile) bool
		want     string
	}{
		{"the Slot's Profile accepts", set(allKeys, hdDefault, hdDefault), only("hd-primary", "any-primary"), "hd-primary"},
		{"only Any accepts", set(allKeys, hdDefault, hdDefault), only("any-primary"), "any-primary"},
		{"the Original-Language rule keeps its own Any", set(allKeys, map[resolution.Class]string{resolution.HD: "hd-original"}, hdDefault), only("any-primary", "any-original"), "any-original"},
		{"Any disabled", set([]string{"hd-primary"}, hdDefault, hdDefault), only("any-primary"), "hd-primary"},
		{"nothing accepts", set(allKeys, hdDefault, hdDefault), only(), "hd-primary"},
	}
	for _, c := range cases {
		got, err := ResolveAccepting(c.profiles, release.KindMovie, resolution.HD, c.accepts)
		if err != nil || got.Key != c.want {
			t.Errorf("%s: got %q, %v, want %q", c.name, got.Key, err, c.want)
		}
	}
}
