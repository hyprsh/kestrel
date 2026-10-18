// Package slot holds the two Slots of a Title (ADR 0012): Standard (up to
// 1080p, the default) and 4K (2160p, opt-in). A Slot is not a resolution
// class: resolution classes (SD, HD, UHD) stay for scoring, probing and Profile
// height bounds.
package slot

import "github.com/hyprsh/kestrel/internal/resolution"

// Slot is one of a Title's two fixed Slots. The values are 0 and 1 so a Slot
// can index an array of Count.
type Slot int

const (
	Standard Slot = iota
	FourK
)

// Count is the number of Slots.
const Count = 2

// All lists the Slots in order.
var All = [Count]Slot{Standard, FourK}

// Key is the stored and API value: "standard" or "4k".
func (s Slot) Key() string {
	if s == FourK {
		return "4k"
	}
	return "standard"
}

// Name is the display name: "Standard" or "4K".
func (s Slot) Name() string {
	if s == FourK {
		return "4K"
	}
	return "Standard"
}

// Label is the text inside the brackets of a file name label.
func (s Slot) Label() string { return s.Name() }

// String is the display name, so a Slot prints readably in messages.
func (s Slot) String() string { return s.Name() }

// Range is the height range of the Slot: Standard 0-1080, 4K 2160-2160. A
// Profile's own bounds lie inside it.
func (s Slot) Range() (min, max int) {
	if s == FourK {
		return 2160, 2160
	}
	return 0, 1080
}

// Contains reports whether the height bounds lie inside the Slot's range.
func (s Slot) Contains(minHeight, maxHeight int) bool {
	lo, hi := s.Range()
	return minHeight >= lo && maxHeight <= hi && minHeight <= maxHeight
}

// Parse reads a stored or API key. Only "standard" and "4k" are Slots.
func Parse(key string) (Slot, bool) {
	switch key {
	case "standard":
		return Standard, true
	case "4k":
		return FourK, true
	}
	return Standard, false
}

// OfClass maps a probed resolution class to a Slot: UHD to 4K, anything else
// to Standard.
func OfClass(c resolution.Class) Slot {
	if c == resolution.UHD {
		return FourK
	}
	return Standard
}
