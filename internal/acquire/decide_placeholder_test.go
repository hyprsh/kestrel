package acquire

import (
	"testing"

	"github.com/hyprsh/kestrel/internal/slot"
)

// unlistedVersion wants S02E01-E04 (held) and the unlisted S02E05.
func unlistedVersion() Version {
	v := Version{Slot: slot.Standard}
	for n := 1; n <= 4; n++ {
		v.Units = append(v.Units, Unit{Ref: EpisodeRef{2, n}, Held: &Held{Fits: true, Score: 500}})
	}
	v.Units = append(v.Units, Unit{Ref: EpisodeRef{2, 5}, Unlisted: true})
	return v
}

func TestAnUnlistedUnitIsPlannedForAReleaseNamingIt(t *testing.T) {
	plans := Decide(Input{Versions: []Version{unlistedVersion()}, Candidates: []Candidate{epCand("e5", 100, 2, []int{5})}})
	wantGUIDs(t, plans, "e5")
	if len(plans[0].Covers) != 1 || plans[0].Covers[0] != (EpisodeRef{2, 5}) {
		t.Fatalf("covers = %v", plans[0].Covers)
	}
}

func TestAReleaseNamingAnUnqualifiedEpisodePlansOnlyItsListedOnes(t *testing.T) {
	unqualified := func(c *Candidate) { c.Unqualified = true }
	plans := Decide(Input{
		Versions:   []Version{unlistedVersion()},
		Candidates: []Candidate{epCand("e4-e7", 900, 2, []int{4, 5, 6, 7}, unqualified)},
	})
	wantGUIDs(t, plans, "e4-e7")
	if len(plans[0].Covers) != 1 || plans[0].Covers[0] != (EpisodeRef{2, 4}) {
		t.Fatalf("covers = %v, want only the listed S02E04", plans[0].Covers)
	}
	plans = Decide(Input{
		Versions:   []Version{unlistedVersion()},
		Candidates: []Candidate{epCand("e5-e7", 900, 2, []int{5, 6, 7}, unqualified)},
	})
	wantGUIDs(t, plans)
}

func TestASeasonPackDoesNotCoverUnlistedUnits(t *testing.T) {
	v := unlistedVersion()
	v.Units[0].Held = nil // S02E01 missing
	plans := Decide(Input{Versions: []Version{v}, Candidates: []Candidate{packCand("pack", 100, 2)}, SeasonsFinished: map[int]bool{2: true}})
	wantGUIDs(t, plans, "pack")
	if len(plans[0].Covers) != 1 || plans[0].Covers[0] != (EpisodeRef{2, 1}) {
		t.Fatalf("covers = %v", plans[0].Covers)
	}
}
