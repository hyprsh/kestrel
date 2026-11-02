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
	// Slots holds every Slot that is on for new Titles and has an enabled default for the kind, in Slot order.
	Slots []SuggestedSlot
}

// Suggest computes the add panel's preselection, shared with Requests: every
// Slot that is on for new Titles, with its default Profile for the kind (ADR 0024).
// A Slot without an enabled default for the kind is left out.
func Suggest(all []profiles.Profile, slots []slot.Record, kind Kind) Suggestion {
	var s Suggestion
	rk := release.KindMovie
	if kind == Series {
		rk = release.KindSeries
	}
	for _, sl := range slots {
		if !sl.OnForNew {
			continue
		}
		r, err := profiles.Resolve(all, rk, sl)
		if err != nil {
			continue
		}
		s.Slots = append(s.Slots, SuggestedSlot{Slot: sl.ID, Profile: r, Reason: ReasonDefault, Label: r.Name})
	}
	return s
}
