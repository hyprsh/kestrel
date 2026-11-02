package profiles

import (
	"errors"
	"testing"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/slot"
)

// set builds the six Profiles with the given keys enabled.
func set(enabled ...string) []Profile {
	on := map[string]bool{}
	for _, k := range enabled {
		on[k] = true
	}
	var out []Profile
	for _, p := range Builtin() {
		p.Enabled = on[p.Key]
		out = append(out, p)
	}
	return out
}

var allKeys = []string{"hd-primary", "hd-original", "any-primary", "any-original", "4k-primary", "4k-original"}

func TestResolveTakesTheSlotsDefaultForTheKind(t *testing.T) {
	sl := slot.Record{ID: "remux", DefaultMovies: "4k-original", DefaultSeries: "hd-original"}
	cases := []struct {
		name     string
		profiles []Profile
		kind     release.Kind
		want     string
		err      error
	}{
		{"movies", set(allKeys...), release.KindMovie, "4k-original", nil},
		{"series", set(allKeys...), release.KindSeries, "hd-original", nil},
		{"the default is disabled", set("hd-primary"), release.KindMovie, "", ErrNoEnabledProfile},
		{"nothing enabled", set(), release.KindMovie, "", ErrNoEnabledProfile},
	}
	for _, c := range cases {
		got, err := Resolve(c.profiles, c.kind, sl)
		if !errors.Is(err, c.err) || got.Key != c.want {
			t.Errorf("%s: got %q, %v, want %q, %v", c.name, got.Key, err, c.want, c.err)
		}
	}
}

func TestASlotWithoutADefaultForTheKindResolvesNothing(t *testing.T) {
	if _, err := Resolve(set(allKeys...), release.KindSeries, slot.Record{ID: "s", DefaultMovies: "hd-primary"}); !errors.Is(err, ErrNoEnabledProfile) {
		t.Errorf("err = %v, want ErrNoEnabledProfile", err)
	}
}

func TestResolveAcceptingFallsToAnyOfTheSameLanguageRule(t *testing.T) {
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
	std := slot.Record{ID: "standard", DefaultMovies: "hd-primary"}
	orig := slot.Record{ID: "standard", DefaultMovies: "hd-original"}
	cases := []struct {
		name     string
		profiles []Profile
		slot     slot.Record
		accepts  func(Profile) bool
		want     string
	}{
		{"the Slot's Profile accepts", set(allKeys...), std, only("hd-primary", "any-primary"), "hd-primary"},
		{"only Any accepts", set(allKeys...), std, only("any-primary"), "any-primary"},
		{"the Original-Language rule keeps its own Any", set(allKeys...), orig, only("any-primary", "any-original"), "any-original"},
		{"Any disabled", set("hd-primary"), std, only("any-primary"), "hd-primary"},
		{"nothing accepts", set(allKeys...), std, only(), "hd-primary"},
	}
	for _, c := range cases {
		got, err := ResolveAccepting(c.profiles, release.KindMovie, c.slot, c.accepts)
		if err != nil || got.Key != c.want {
			t.Errorf("%s: got %q, %v, want %q", c.name, got.Key, err, c.want)
		}
	}
}
