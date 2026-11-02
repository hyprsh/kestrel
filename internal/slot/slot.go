// Package slot holds the Slots of a library (ADR 0024) and the rules every one
// of them obeys. The admin defines the Slots: Standard (up to 1080p, on for new
// Titles) and 4K (2160p, off) are only what a library starts with. A Slot is not
// a resolution class: resolution classes (SD, HD, UHD) stay for scoring,
// probing and Profile height bounds.
package slot

import (
	"cmp"
	"slices"
	"strings"
	"unicode"

	"github.com/hyprsh/kestrel/internal/resolution"
)

// Slot is the id of a Slot: the slug an admin's Slot got when it was created. It
// is the stored and API value. standard and 4k are the two Slots every library
// starts with, but they are ordinary Slots: any id of a stored Slot is a Slot,
// and which ones exist is the store's to say (internal/slot/slots).
type Slot string

// The two Slots a library is seeded with. Code that still switches on them
// predates admin-defined Slots and goes as the follow-up tickets reach it.
const (
	Standard Slot = "standard"
	FourK    Slot = "4k"
)

// All lists the two seeded Slots in order, for the code that still walks them.
var All = []Slot{Standard, FourK}

// Key is the stored and API value: the id.
func (s Slot) Key() string { return string(s) }

// Name is the display name of a seeded Slot, "Standard" or "4K"; any other Slot
// shows its id until its stored label is read.
func (s Slot) Name() string {
	switch s {
	case Standard:
		return "Standard"
	case FourK:
		return "4K"
	}
	return string(s)
}

// Label is the text inside the brackets of a file name label.
func (s Slot) Label() string { return s.Name() }

// String is the display name, so a Slot prints readably in messages.
func (s Slot) String() string { return s.Name() }

// Range is the height range of the Slot: Standard 0-1080, 4K 2160-2160, any
// other Slot 0-2160. A Profile's own bounds lie inside it.
func (s Slot) Range() (min, max int) {
	switch s {
	case FourK:
		return 2160, 2160
	case Standard:
		return 0, 1080
	}
	return 0, 2160
}

// Contains reports whether the height bounds lie inside the Slot's range.
func (s Slot) Contains(minHeight, maxHeight int) bool {
	lo, hi := s.Range()
	return minHeight >= lo && maxHeight <= hi && minHeight <= maxHeight
}

// maxIDLen bounds an id: a 24-character label of "+" slugs to 96 characters.
const maxIDLen = 100

// Parse reads a stored or API id. It checks the shape of an id (lower-case
// letters, digits and single hyphens between them), not whether a Slot of that
// id exists.
func Parse(key string) (Slot, bool) {
	if key == "" || len(key) > maxIDLen || strings.HasPrefix(key, "-") || strings.HasSuffix(key, "-") || strings.Contains(key, "--") {
		return Standard, false
	}
	for _, r := range key {
		if r != '-' && !unicode.IsDigit(r) && !(unicode.IsLetter(r) && !unicode.IsUpper(r)) {
			return Standard, false
		}
	}
	return Slot(key), true
}

// Compare orders two Slots: the seeded ones first, as All lists them, then any
// other by id. It stands in for the order the admin gave the Slots until the
// code that lists them reads their positions from the store.
func Compare(a, b Slot) int {
	rank := func(s Slot) int {
		if i := slices.Index(All, s); i >= 0 {
			return i
		}
		return len(All)
	}
	if c := cmp.Compare(rank(a), rank(b)); c != 0 {
		return c
	}
	return cmp.Compare(a, b)
}

// OfClass maps a probed resolution class to a Slot: UHD to 4K, anything else
// to Standard.
func OfClass(c resolution.Class) Slot {
	if c == resolution.UHD {
		return FourK
	}
	return Standard
}
