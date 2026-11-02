package slot

import (
	"fmt"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

// MaxSlots is the most Slots a library has (ADR 0024).
const MaxSlots = 4

// maxLabel is the longest label, in characters.
const maxLabel = 24

// Record is a stored Slot. Position is its place in the order, 0-based.
// DefaultMovies and DefaultSeries are Profile keys, empty for none.
type Record struct {
	ID            Slot
	Label         string
	DefaultMovies string
	DefaultSeries string
	OnForNew      bool
	Position      int
}

// RuleError is a Slot rule broken. The API answers it 422, or 409 when Conflict
// (the rule is about what the library holds, not about the value sent); a Config
// File words it under its `slots` section. Field names the field at fault, empty
// for a rule about the Slots as a whole.
type RuleError struct {
	Field    string
	Message  string
	Conflict bool
}

func (e *RuleError) Error() string {
	if e.Field == "" {
		return e.Message
	}
	return e.Field + ": " + e.Message
}

func invalid(field, format string, args ...any) *RuleError {
	return &RuleError{Field: field, Message: fmt.Sprintf(format, args...)}
}

func conflict(format string, args ...any) *RuleError {
	return &RuleError{Message: fmt.Sprintf(format, args...), Conflict: true}
}

// CheckLabel applies the label rule: 1 to 24 characters of letters (any
// script), digits, spaces, `-` and `+`, with no leading or trailing space.
func CheckLabel(label string) error {
	n := utf8.RuneCountInString(label)
	switch {
	case n == 0:
		return invalid("label", "must not be empty")
	case n > maxLabel:
		return invalid("label", "must be at most %d characters", maxLabel)
	case strings.HasPrefix(label, " ") || strings.HasSuffix(label, " "):
		return invalid("label", "must not start or end with a space")
	}
	for _, r := range label {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != ' ' && r != '-' && r != '+' {
			return invalid("label", "may hold only letters, digits, spaces, - and +, not %q", r)
		}
	}
	return nil
}

// CheckSet applies the rules about all the Slots at once: at most four, at
// least one, at least one on for new Titles, every label valid and unique
// ignoring case. The Slots are the whole set as it would stand.
func CheckSet(set []Record) error {
	switch {
	case len(set) > MaxSlots:
		return invalid("", "a library has at most %d Slots", MaxSlots)
	case len(set) == 0:
		return conflict("a library needs at least one Slot")
	}
	seen := map[string]Slot{}
	for _, r := range set {
		if err := CheckLabel(r.Label); err != nil {
			return err
		}
		key := strings.ToLower(r.Label)
		if other, dup := seen[key]; dup {
			return invalid("label", "%q is already used by the Slot %s: labels are unique ignoring case", r.Label, other)
		}
		seen[key] = r.ID
	}
	if !slices.ContainsFunc(set, func(r Record) bool { return r.OnForNew }) {
		return conflict("at least one Slot must be on for new Titles")
	}
	return nil
}

// IDFor derives the id of a new Slot from its first label: lower case, runs of
// spaces and hyphens as one hyphen, `+` as "plus". An id that is taken gets
// "-2", "-3" and so on.
func IDFor(label string, taken []Slot) Slot {
	var b strings.Builder
	for _, r := range strings.ToLower(label) {
		switch {
		case r == '+':
			b.WriteString("plus")
		case r == ' ' || r == '-':
			if s := b.String(); s != "" && !strings.HasSuffix(s, "-") {
				b.WriteByte('-')
			}
		default:
			b.WriteRune(r)
		}
	}
	base := strings.Trim(b.String(), "-")
	if base == "" {
		base = "slot"
	}
	id := Slot(base)
	for n := 2; slices.Contains(taken, id); n++ {
		id = Slot(fmt.Sprintf("%s-%d", base, n))
	}
	return id
}
