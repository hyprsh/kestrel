package acquire

import "github.com/hyprsh/kestrel/internal/scoring"

// OriginalOffers is Decide's counterpart for Original Offers (#103): what it
// would grab for each Version if the Releases whose one rejection is
// original_only were acceptable, limited to the units Decide leaves missing or
// misfit. A Primary-Language Release that Decide plans always wins its units,
// a fitting file (an Original included) is never offered against, and a Series
// takes its packs and episodes by Decide's own rules. Like Decide it is pure.
func OriginalOffers(in Input) []GrabPlan {
	planned := map[Slot]map[EpisodeRef]bool{}
	for _, p := range Decide(in) {
		if planned[p.Slot] == nil {
			planned[p.Slot] = map[EpisodeRef]bool{}
		}
		for _, r := range p.Covers {
			planned[p.Slot][r] = true
		}
	}
	offer := Input{SeasonsFinished: in.SeasonsFinished}
	for _, v := range in.Versions {
		ov := Version{Slot: v.Slot}
		for _, u := range v.Units {
			if (u.Held == nil || !u.Held.Fits) && !planned[v.Slot][u.Ref] {
				ov.Units = append(ov.Units, u)
			}
		}
		if len(ov.Units) > 0 {
			offer.Versions = append(offer.Versions, ov)
		}
	}
	for _, c := range in.Candidates {
		oc := c
		oc.Verdicts = map[Slot]scoring.Verdict{}
		for s, v := range c.Verdicts {
			if len(v.Rejections) == 1 && v.Rejections[0] == scoring.RejectOriginalOnly {
				v.Accepted, v.Rejections = true, nil
				oc.Verdicts[s] = v
			}
		}
		if len(oc.Verdicts) > 0 {
			offer.Candidates = append(offer.Candidates, oc)
		}
	}
	if len(offer.Versions) == 0 || len(offer.Candidates) == 0 {
		return nil
	}
	return Decide(offer)
}
