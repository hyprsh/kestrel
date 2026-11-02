package imports

import (
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/slot"
)

func TestLabelAtReadsTheLabelOfTheNamesKestrelWrites(t *testing.T) {
	film := Title{Name: "Film", Year: 2020, TMDBID: 1}
	show := Title{Name: "Show", Year: 2020, TVDBID: 2}
	facts := FileFacts{Release: release.ParsedRelease{ReleaseGroup: "GRP"}}
	base := func(name string, err error) string {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		return strings.TrimSuffix(name, ".mkv")
	}
	for _, label := range []string{"4K", "Standard", "Kids + Dub", "German"} {
		if got := labelAt(film, base(MovieFileName(film, label, facts, ".mkv")), false); got != label {
			t.Errorf("a Movie file of the label %q reads as %q", label, got)
		}
		for _, ep := range []Episode{{Season: 1, First: 2, Last: 2}, {Season: 1, First: 2, Last: 3}, {Season: 0, First: 1, Last: 1}} {
			if got := labelAt(show, base(EpisodeFileName(show, label, ep, facts, ".mkv")), true); got != label {
				t.Errorf("an episode file %+v of the label %q reads as %q", ep, label, got)
			}
		}
	}
	// A loose file reads the same: the name carries the label, not the folder.
	loose := base(MovieFileName(film, "4K", facts, ".mkv"))
	if got := labelAt(film, strings.ToLower(loose), false); !strings.EqualFold(got, "4K") {
		t.Errorf("a loose Movie file in other case reads as %q", got)
	}
}

func TestLabelAtReadsOnlyTheFixedPosition(t *testing.T) {
	film := Title{Name: "Film", Year: 2020, TMDBID: 1}
	show := Title{Name: "Show", Year: 2020, TVDBID: 2}
	tests := []struct {
		name   string
		base   string
		title  Title
		series bool
	}{
		{"the label is not first", "Film (2020) {tmdb-1} - [Remux-2160p][4K]", film, false},
		{"no bracket after the prefix", "Film (2020) {tmdb-1} - 4K", film, false},
		{"another title", "Other (2020) {tmdb-9} - [4K]", film, false},
		{"an episode without a label", "Show (2020) - S01E02 - Pilot [4K]", show, true},
		{"a series file named like a movie", "Show (2020) - [4K]", show, true},
		{"the folder name of a Series is not the file prefix", "Show (2020) {tvdb-2} - S01E02 - [4K]", show, true},
	}
	for _, tt := range tests {
		got := labelAt(tt.title, tt.base, tt.series)
		if tt.name == "the label is not first" {
			if got != "Remux-2160p" {
				t.Errorf("%s: labelAt(%q) = %q, want the first bracket", tt.name, tt.base, got)
			}
			continue
		}
		if got != "" {
			t.Errorf("%s: labelAt(%q) = %q, want none", tt.name, tt.base, got)
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
