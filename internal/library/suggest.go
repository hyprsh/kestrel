package library

import (
	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
	"github.com/hyprsh/kestrel/internal/slot"
)

// Reason says why a Slot was preselected with its Profile.
type Reason string

const (
	// ReasonDefault: the Slot's default Profile for the kind.
	ReasonDefault Reason = "default"
)

// SuggestedSlot is one preselected Slot.
type SuggestedSlot struct {
	Slot    slot.Slot
	Profile profiles.Profile
	Reason  Reason
	// Label names the Profile for the add panel.
	Label string
}

// Suggestion is what the add panel preselects for a Title.
type Suggestion struct {
	// Slots holds every Slot that has a default for the kind, in Slot order.
	Slots []SuggestedSlot
}

// Suggest computes the add panel's preselection, shared with Requests: every
// Slot with a default Profile for the kind, resolved by Profile resolution
// (PRD Settled 8).
func Suggest(all []profiles.Profile, kind Kind) Suggestion {
	var s Suggestion
	rk := release.KindMovie
	if kind == Series {
		rk = release.KindSeries
	}
	for _, sl := range slot.All {
		hasDefault := false
		for _, p := range all {
			if p.Enabled && p.Slot == sl && p.Default(rk) {
				hasDefault = true
			}
		}
		if !hasDefault {
			continue
		}
		r, err := profiles.Resolve(all, rk, sl)
		if err != nil {
			continue
		}
		out := SuggestedSlot{Slot: sl, Profile: r, Reason: ReasonDefault, Label: r.Name}
		s.Slots = append(s.Slots, out)
	}
	return s
}
