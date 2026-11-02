// Package slot holds the Slots of a library (ADR 0024) and the rules every one
// of them obeys. The admin defines the Slots: Standard (up to 1080p, on for new
// Titles) and 4K (2160p, off) are only what a library starts with. A Slot is not
// a resolution class: resolution classes (SD, HD, UHD) stay for scoring,
// probing and Profile height bounds.
package slot

import (
	"strings"
	"unicode"
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

// Key is the stored and API value: the id.
func (s Slot) Key() string { return string(s) }

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
