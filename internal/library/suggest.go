package library

import (
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/resolution"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
)

// Reason says why a Slot was preselected with its Profile.
type Reason string

const (
	// ReasonDefault: the Slot's default Profile for the kind.
	ReasonDefault Reason = "default"
	// ReasonKidsRule: the Kids rule swapped the HD Profile for its Kids counterpart.
	ReasonKidsRule Reason = "kids_rule"
)

// SuggestedSlot is one preselected Slot.
type SuggestedSlot struct {
	Slot    resolution.Class
	Profile profiles.Profile
	Reason  Reason
	// Label names the Profile for the add panel; under the Kids rule it carries
	// the certification: "Kids (FSK 6)".
	Label string
}

// Suggestion is what the add panel preselects for a Title.
type Suggestion struct {
	// Slots holds every Slot that has a default for the kind, in Slot order.
	Slots []SuggestedSlot
	// Certification is the rating the Kids rule read and the country it is a
	// rating of (the release-date country, else the US, else the earliest
	// anywhere); both are empty when TMDB has none.
	CertificationCountry string
	Certification        string
}

// Suggest computes the add panel's preselection, shared with Requests: every
// Slot with a default Profile for the kind, resolved by Profile resolution
// (PRD Settled 8), with the Kids rule applied to HD when the Title's
// certification reads as a kids' age (Settled 7). country is the
// release-date country.
func Suggest(all []profiles.Profile, kind Kind, rel metadata.ReleaseDates, country string, kids profiles.KidsRule) Suggestion {
	certCountry, cert := rel.Certification(country)
	s := Suggestion{CertificationCountry: certCountry, Certification: cert}
	isKids := kids.Applies(certCountry, cert)
	rk := release.KindMovie
	if kind == Series {
		rk = release.KindSeries
	}
	for _, slot := range []resolution.Class{resolution.SD, resolution.HD, resolution.UHD} {
		hasDefault := false
		for _, p := range all {
			if p.Enabled && p.Slot == slot && p.Default(rk) {
				hasDefault = true
			}
		}
		if !hasDefault {
			continue
		}
		r, err := profiles.Resolve(all, rk, slot, isKids)
		if err != nil {
			continue
		}
		out := SuggestedSlot{Slot: slot, Profile: r.Profile, Reason: ReasonDefault, Label: r.Name}
		if r.KidsSwap {
			out.Reason = ReasonKidsRule
			out.Label = profiles.KidsLabel(certCountry, cert)
		}
		s.Slots = append(s.Slots, out)
	}
	return s
}

// KidsHD reports whether the HD Version among these specs has a Kids Profile.
// An add names its Profiles, so there a Kids HD Profile means the Kids root
// folder; a Request may leave the Profile to resolution, which decides by
// whether the Kids rule chose it.
func KidsHD(all []profiles.Profile, specs []VersionSpec) bool {
	for _, sp := range specs {
		if sp.Slot != resolution.HD {
			continue
		}
		for _, p := range all {
			if p.Key == sp.Profile {
				return p.Kids
			}
		}
	}
	return false
}
