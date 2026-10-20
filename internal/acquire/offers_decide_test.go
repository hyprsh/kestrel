package acquire

import (
	"testing"

	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/slot"
)

// originalOnly makes a candidate an Original-only Release under an offering Profile.
func originalOnly(c *Candidate) {
	v := c.Verdicts[slot.Standard]
	v.Accepted, v.Rejections = false, []scoring.Rejection{scoring.RejectOriginalOnly}
	c.Verdicts[slot.Standard] = v
}

func TestAnyAcceptableReleaseReplacesAnOriginalWhateverItsScore(t *testing.T) {
	held := &Held{Fits: true, Score: 5000, Original: true}
	plans := Decide(Input{Versions: []Version{movieVersion(held)}, Candidates: []Candidate{movieCand("low", -100)}})
	wantGUIDs(t, plans, "low")
	if !plans[0].Upgrade {
		t.Errorf("plan = %+v, want an Upgrade", plans[0])
	}
	// Another Original-only Release is no Primary-Language one: never planned.
	wantGUIDs(t, Decide(Input{Versions: []Version{movieVersion(held)}, Candidates: []Candidate{movieCand("orig", 9000, originalOnly)}}))
}

func TestAnOriginalOnlyReleaseIsOfferedForAMissingMovie(t *testing.T) {
	in := Input{
		Versions:   []Version{movieVersion(nil)},
		Candidates: []Candidate{movieCand("o1", 10, originalOnly), movieCand("o2", 30, originalOnly), movieCand("lang", 90, langRejected)},
	}
	wantGUIDs(t, Decide(in))
	offers := OriginalOffers(in)
	wantGUIDs(t, offers, "o2")
	if offers[0].Slot != slot.Standard || len(offers[0].Covers) != 1 {
		t.Errorf("offer = %+v", offers[0])
	}
}

func langRejected(c *Candidate) {
	v := c.Verdicts[slot.Standard]
	v.Accepted, v.Rejections = false, []scoring.Rejection{scoring.RejectLanguage}
	c.Verdicts[slot.Standard] = v
}

func TestNoOfferWhileAPrimaryLanguageReleaseIsGrabbedOrTheFileFits(t *testing.T) {
	cases := []struct {
		name  string
		held  *Held
		cands []Candidate
		want  []string
	}{
		{"a Primary-Language Release wins", nil, []Candidate{movieCand("orig", 900, originalOnly), movieCand("prim", 1)}, nil},
		{"a fitting file", &Held{Fits: true, Score: 1}, []Candidate{movieCand("orig", 900, originalOnly)}, nil},
		{"an Original already held", &Held{Fits: true, Score: 1, Original: true}, []Candidate{movieCand("orig", 900, originalOnly)}, nil},
		{"a misfit is replaced", &Held{Fits: false}, []Candidate{movieCand("orig", 900, originalOnly)}, []string{"orig"}},
		{"other rejections too", nil, []Candidate{movieCand("orig", 900, originalOnly, func(c *Candidate) {
			v := c.Verdicts[slot.Standard]
			v.Rejections = append(v.Rejections, scoring.RejectBelowMinScore)
			c.Verdicts[slot.Standard] = v
		})}, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			wantGUIDs(t, OriginalOffers(Input{Versions: []Version{movieVersion(tc.held)}, Candidates: tc.cands}), tc.want...)
		})
	}
}

func TestASeriesIsOfferedWhatNoPrimaryLanguageReleaseCovers(t *testing.T) {
	v := Version{Slot: slot.Standard, Units: []Unit{
		{Ref: EpisodeRef{1, 1}}, {Ref: EpisodeRef{1, 2}}, {Ref: EpisodeRef{1, 3}}, {Ref: EpisodeRef{2, 1}},
	}}
	in := Input{
		Versions:        []Version{v},
		SeasonsFinished: map[int]bool{1: true},
		Candidates: []Candidate{
			epCand("e1-primary", 10, 1, []int{1}),
			packCand("s1-orig", 50, 1, originalOnly),
			epCand("s2e1-orig", 20, 2, []int{1}, originalOnly),
		},
	}
	offers := OriginalOffers(in)
	wantGUIDs(t, offers, "s1-orig", "s2e1-orig")
	if c := offers[0].Covers; !offers[0].Pack || len(c) != 2 || c[0] != (EpisodeRef{1, 2}) || c[1] != (EpisodeRef{1, 3}) {
		t.Errorf("pack offer = %+v, want S01E02-E03", offers[0])
	}
}
