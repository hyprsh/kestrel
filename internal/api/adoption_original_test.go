package api_test

import (
	"testing"
)

// offeringOriginals makes the household German and hd-primary offer the
// English-only Releases of English-original Titles for approval.
func (a adopting) offeringOriginals(t *testing.T) {
	t.Helper()
	if r := a.valid("PATCH", "/settings", `{"language_region":{"primary_language":"de"}}`); r.Status != 200 {
		t.Fatalf("PATCH /settings = %d %s", r.Status, r.Body)
	}
	a.trashPass(t)
	if r := a.valid("PATCH", "/profiles/hd-primary", `{"original_language":"offer"}`); r.Status != 200 {
		t.Fatalf("PATCH /profiles = %d %s", r.Status, r.Body)
	}
}

// Only a file imported from an accepted Original Offer is an Original: an
// adopted file with the Original Language only is a misfit, so its Version
// stays Wanted and the offer can still be made.

func TestAnAdoptedOriginalOnlyMovieFileIsAMisfitUnderAnOfferingProfile(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	a.offeringOriginals(t)
	a.put(t, "Paddington (2014) {tmdb-116149}/Paddington.2014.1080p.BluRay.x264-GRP.mkv", "x") // English audio only

	a.commit(t, a.scan(t).Revision)

	id := a.titleIDOf(t, 116149)
	if a.titleFiles(t, id)["standard"] == "" {
		t.Fatal("the file was not adopted")
	}
	if got := a.stateOf(t, id, "standard"); got != "wanted" {
		t.Errorf("Standard Version state = %q, want wanted", got)
	}
}

func TestAnAdoptedOriginalOnlyEpisodeFileIsAMisfitUnderAnOfferingProfile(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	a.offeringOriginals(t)
	a.putTV(t, bbFolder+"/Season 01/Breaking.Bad.S01E01.1080p.WEB-DL.x264-GRP.mkv", "x") // English audio only

	a.commit(t, a.scan(t).Revision)

	for _, e := range episodesOf(t, a.library, a.titleIDOf(t, 1396)) {
		if e.Season == 1 && e.Number == 1 && (e.Cells.Standard == nil || e.Cells.Standard.State != "wanted") {
			t.Errorf("S01E01 = %+v, want wanted", e.Cells.Standard)
		}
	}
}
