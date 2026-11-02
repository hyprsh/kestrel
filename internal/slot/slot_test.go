package slot_test

import (
	"slices"
	"testing"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/slot"
)

func TestTheSeededIdsParse(t *testing.T) {
	for _, s := range []slot.Slot{slot.Standard, slot.FourK} {
		got, ok := slot.Parse(s.Key())
		if !ok || got != s {
			t.Errorf("Parse(%q) = %v, %v", s.Key(), got, ok)
		}
	}
}

func TestParseChecksTheShapeOfAnId(t *testing.T) {
	for _, k := range []string{"remux", "german-dub", "kidsplus", "über", "4k"} {
		if got, ok := slot.Parse(k); !ok || got != slot.Slot(k) {
			t.Errorf("Parse(%q) = %q, %v", k, got, ok)
		}
	}
	for _, k := range []string{"", "Standard", "4K", "a b", "-a", "a-", "a--b", "a[b"} {
		if _, ok := slot.Parse(k); ok {
			t.Errorf("Parse(%q) accepted", k)
		}
	}
}

func TestLabelIsTheStoredOneElseTheId(t *testing.T) {
	set := []slot.Record{{ID: "standard", Label: "Everyday"}, {ID: "original", Label: "Original"}}
	if got := slot.Label(set, "standard"); got != "Everyday" {
		t.Errorf("stored label = %q", got)
	}
	if got := slot.Label(set, "gone"); got != "gone" {
		t.Errorf("unknown Slot = %q", got)
	}
}

func TestADefaultIsPerKind(t *testing.T) {
	r := slot.Record{DefaultMovies: "hd-primary", DefaultSeries: "any-primary"}
	if r.Default(release.KindMovie) != "hd-primary" || r.Default(release.KindSeries) != "any-primary" {
		t.Errorf("defaults = %q, %q", r.Default(release.KindMovie), r.Default(release.KindSeries))
	}
}

func TestSharedDefaultsNameEverySlotSharingAProfile(t *testing.T) {
	set := []slot.Record{
		{ID: "standard", DefaultMovies: "hd-primary", DefaultSeries: "hd-primary"},
		{ID: "4k", DefaultMovies: "4k-primary", DefaultSeries: "hd-primary"},
		{ID: "original", DefaultMovies: "hd-primary"},
	}
	got := slot.SharedDefaults(set)
	if len(got) != 2 || got[0].Kind != release.KindMovie || got[0].Profile != "hd-primary" || !slices.Equal(got[0].Slots, []slot.Slot{"standard", "original"}) ||
		got[1].Kind != release.KindSeries || !slices.Equal(got[1].Slots, []slot.Slot{"standard", "4k"}) {
		t.Errorf("shared = %+v", got)
	}
}
