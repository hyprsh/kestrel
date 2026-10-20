package api_test

import (
	"fmt"
	"testing"
)

func (a adopting) stateOf(t *testing.T, id int64, slot string) string {
	t.Helper()
	d := decode[titleJSON](t, a.valid("GET", fmt.Sprintf("/titles/%d", id), ""))
	for _, v := range d.Versions {
		if v.Slot == slot {
			return v.State
		}
	}
	return "none"
}

func TestAnAdoptedFileThatFailsTheResolutionGateIsTheBaselineAndItsVersionIsWanted(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	// A 1080p file under Kestrel's own 4K label: the 4K Profile does not take it.
	a.put(t, "Paddington (2014) {tmdb-116149}/Paddington (2014) {tmdb-116149} - [4K][Bluray-1080p][English][h264]-GRP.mkv", "x")

	a.commit(t, a.scan(t).Revision)

	id := a.titleIDOf(t, 116149)
	if a.titleFiles(t, id)["4k"] == "" {
		t.Fatal("the misfit file was not adopted as the baseline")
	}
	if got := a.stateOf(t, id, "4k"); got != "wanted" {
		t.Errorf("4K Version state = %q, want wanted", got)
	}
}

func TestAnAdoptedFileInTheWrongLanguageMakesItsVersionWantedWhileAFittingOneIsFilled(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	a.put(t, "Paddington (2014) {tmdb-116149}/Paddington (2014) {tmdb-116149} - [Standard][Bluray-1080p][English][h264]-GRP french.mkv", "x")
	a.put(t, "Paddington (2014) uhd/Paddington.2014.2160p.BluRay.x265-GRP.mkv", "x")

	a.commit(t, a.scan(t).Revision)

	id := a.titleIDOf(t, 116149)
	if got := a.stateOf(t, id, "standard"); got != "wanted" {
		t.Errorf("Standard Version (French audio) state = %q, want wanted", got)
	}
	if got := a.stateOf(t, id, "4k"); got != "filled" {
		t.Errorf("4K Version state = %q, want filled", got)
	}
}
