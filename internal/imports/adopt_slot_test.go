package imports

import (
	"testing"

	"github.com/hyprsh/kestrel/internal/slot"
)

func TestLabelAtReadsOnlyTheFixedPosition(t *testing.T) {
	const film = "Film (2020) {tmdb-1}"
	const show = "Show (2020) {tvdb-2}"
	tests := []struct {
		name         string
		base, folder string
		series       bool
		want         string
	}{
		{"a movie label", film + " - [4K][Remux-2160p][German][h265]-GRP", film, false, "4K"},
		{"only a language bracket", film + " - [German][Bluray-1080p]-GRP", film, false, "German"},
		{"ignores the folder's case", "film (2020) {tmdb-1} - [Standard][x]", film, false, "Standard"},
		{"the label is not first", film + " - [Remux-2160p][4K]", film, false, "Remux-2160p"},
		{"no bracket after the prefix", film + " - 4K", film, false, ""},
		{"the label sits elsewhere", "Other - [4K]", film, false, ""},
		{"a label with a space", film + " - [Kids + Dub][Bluray-1080p]", film, false, "Kids + Dub"},
		{"an episode", show + " - S01E02 - [Original][WEBDL-1080p]-GRP", show, true, "Original"},
		{"an episode range", show + " - S01E02-E03 - [4K][WEBDL-2160p]", show, true, "4K"},
		{"an episode without a label", show + " - S01E02 - Pilot [4K]", show, true, ""},
		{"a series file named like a movie", show + " - [4K]", show, true, ""},
		{"no folder", "Film - [4K]", "", false, ""},
	}
	for _, tt := range tests {
		if got := labelAt(tt.base, tt.folder, tt.series); got != tt.want {
			t.Errorf("%s: labelAt(%q) = %q, want %q", tt.name, tt.base, got, tt.want)
		}
	}
}

func TestChooseSlot(t *testing.T) {
	remux := slot.Record{ID: "remux", Label: "Remux"}
	fourK := slot.Record{ID: "4k", Label: "4K"}
	german := slot.Record{ID: "german", Label: "German"}
	std := slot.Record{ID: "standard", Label: "Original"}
	aliases := map[slot.Slot][]string{"standard": {"Standard"}}
	covers := func(m map[slot.Slot]bool) func(slot.Record) bool {
		return func(r slot.Record) bool { return m[r.ID] }
	}
	tests := []struct {
		name    string
		set     []slot.Record
		label   string
		covers  map[slot.Slot]bool
		want    slot.Slot
		guessed bool
	}{
		{"a label picks its Slot", []slot.Record{std, fourK}, "4K", nil, "4k", false},
		{"an alias picks its Slot", []slot.Record{std, fourK}, "Standard", nil, "standard", false},
		{"a language Slot by label alone", []slot.Record{std, fourK, german}, "German", nil, "german", false},
		{"unlabelled 2160p goes to the first Slot that covers it", []slot.Record{remux, fourK}, "", map[slot.Slot]bool{"remux": true, "4k": true}, "remux", true},
		{"a later Slot that covers it", []slot.Record{std, fourK}, "", map[slot.Slot]bool{"4k": true}, "4k", true},
		{"an unknown label counts as none", []slot.Record{std, fourK}, "Remux", map[slot.Slot]bool{"4k": true}, "4k", true},
		{"nothing covers it, so the first Slot", []slot.Record{std, fourK}, "", nil, "standard", true},
	}
	for _, tt := range tests {
		got, guessed := chooseSlot(tt.set, aliases, tt.label, covers(tt.covers))
		if got != tt.want || guessed != tt.guessed {
			t.Errorf("%s: got %q guessed %v, want %q guessed %v", tt.name, got, guessed, tt.want, tt.guessed)
		}
	}
}
