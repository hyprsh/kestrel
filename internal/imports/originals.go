package imports

import (
	"slices"

	"github.com/hyprsh/kestrel/internal/probe"
	"github.com/hyprsh/kestrel/internal/scoring"
)

// fitOf is how a file sits in its Version under its Profile's Verdict. A
// misfit fails the Profile's gates: a resolution class it does not take, audio
// in the wrong language, or the Original Language only unless admitted. A file
// is admitted when the admin let it in despite that: it came from an
// overridden Grab (an accepted Original Offer or "Grab anyway"), or it is an
// Original already, which a rescore keeps. original says the admitted file is
// an Original. Any other Original-only file, an adopted one say, is a misfit.
func fitOf(profile *scoring.Profile, info probe.Info, v scoring.Verdict, admitted bool) (misfit, original bool) {
	original = admitted && v.Rejected(scoring.RejectOriginalOnly)
	misfit = !slices.Contains(profile.Classes(), info.Class()) || v.Rejected(scoring.RejectLanguage) ||
		v.Rejected(scoring.RejectOriginalOnly) && !admitted
	return misfit, original
}

// replacesOriginal says whether a file with Verdict v replaces a held file
// whatever the Scores: the held file is an Original (an accepted Original
// Offer) and the new one is not.
func replacesOriginal(heldOriginal bool, v scoring.Verdict) bool {
	return heldOriginal && !v.Rejected(scoring.RejectOriginalOnly)
}
