package api_test

import "testing"

func TestAFolderWhoseYearIsOffByOneGetsTheRightMovieAsAConfidentSuggestionAtTheTop(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	// The fake search for "Dune" answers Dune Part Two, Dune (2021), Dune (1984) and Dune Drifter (2020):
	// none has the exact title and year, but only Dune (2021) is the title within a year.
	a.put(t, "Dune (2020)/dune.mkv", "x")
	a.scan(t)

	row := a.rowOf(t, "Dune (2020)")

	if row.Status != "needs_choice" || len(row.Candidates) == 0 {
		t.Fatalf("row = %+v", row)
	}
	if top := row.Candidates[0]; top.TMDBID != 438631 || !top.Suggested || !top.Confident {
		t.Errorf("first candidate = %+v, want Dune (2021) suggested and confident", top)
	}
	for _, c := range row.Candidates[1:] {
		if c.Suggested || c.Confident {
			t.Errorf("only one candidate is suggested: %+v", c)
		}
	}
}

func TestASuggestionIsNotConfidentWhenTheYearIsUnknownOrFarOff(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	a.put(t, "Dune/dune.mkv", "x")
	a.put(t, "Dune (1990)/dune.mkv", "x")
	a.scan(t)

	for _, entry := range []string{"Dune", "Dune (1990)"} {
		row := a.rowOf(t, entry)
		if row.Status != "needs_choice" || len(row.Candidates) == 0 {
			t.Fatalf("%s = %+v", entry, row)
		}
		if !row.Candidates[0].Suggested || row.Candidates[0].Confident {
			t.Errorf("%s: first candidate = %+v, want suggested but not confident", entry, row.Candidates[0])
		}
	}
}

func TestAMovieTooShortForItsFilesIsTheOneCandidateAndSuggestedConfidently(t *testing.T) {
	t.Parallel()
	a := newAdopting(t)
	a.put(t, "Paddington (2014)/paddington.short.mkv", "x")
	a.scan(t)

	row := a.rowOf(t, "Paddington (2014)")

	if row.Status != "needs_choice" || len(row.Candidates) != 1 {
		t.Fatalf("row = %+v", row)
	}
	if c := row.Candidates[0]; c.TMDBID != 116149 || !c.Suggested || !c.Confident {
		t.Errorf("candidate = %+v", c)
	}
}
