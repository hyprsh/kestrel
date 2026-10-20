package imports

import "github.com/hyprsh/kestrel/internal/scoring"

// languageRejected says whether the file's audio fails the Profile's language
// rule. An Original-only file (the Profile offers such Releases) comes in only
// through a Grab made despite its rejections: an accepted Original Offer or
// "Grab anyway". A Grab whose name promised Primary-Language audio but whose
// file has none is rejected as language, as it would be without the offer.
func languageRejected(v scoring.Verdict, g Grab) bool {
	return v.Rejected(scoring.RejectLanguage) || v.Rejected(scoring.RejectOriginalOnly) && !g.Overridden
}

// replacesOriginal says whether a file with Verdict v replaces a held file
// whatever the Scores: the held file is an Original (an accepted Original
// Offer) and the new one is not.
func replacesOriginal(heldOriginal bool, v scoring.Verdict) bool {
	return heldOriginal && !v.Rejected(scoring.RejectOriginalOnly)
}
