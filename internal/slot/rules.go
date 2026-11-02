package slot

import (
	"fmt"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/hyprsh/kestrel/internal/release"
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

// Default is the Profile key the Slot names as its default for the kind of
// Title; empty for none.
func (r Record) Default(kind release.Kind) string {
	if kind == release.KindSeries {
		return r.DefaultSeries
	}
	return r.DefaultMovies
}

// Label is the stored label of the Slot with the id in set, else the id: a Slot
// no record names has no label to show.
func Label(set []Record, id Slot) string {
	for _, r := range set {
		if r.ID == id {
			return r.Label
		}
	}
	return string(id)
}

// SharedDefault is a Profile that two or more Slots name as their default for
// one kind of Title (ADR 0024). A Title's Versions use different Profiles, so
// Versions in those Slots could not both take it. It is a warning, not an error.
type SharedDefault struct {
	Kind    release.Kind
	Profile string
	Slots   []Slot
}

// Message words the warning for an admin.
func (w SharedDefault) Message() string {
	ids := make([]string, len(w.Slots))
	for i, id := range w.Slots {
		ids[i] = string(id)
	}
	kind := "movies"
	if w.Kind == release.KindSeries {
		kind = "series"
	}
	return "The Slots " + strings.Join(ids, " and ") + " share the Profile " + w.Profile + " as their default for " + kind + ": a Title's Versions use different Profiles, so only one of them can take it"
}

// SharedDefaults lists every (kind, Profile) that two or more of the Slots name
// as their default, Movies first, in the order the Slots first name them.
func SharedDefaults(set []Record) []SharedDefault {
	var out []SharedDefault
	for _, kind := range []release.Kind{release.KindMovie, release.KindSeries} {
		by := map[string][]Slot{}
		var order []string
		for _, r := range set {
			key := r.Default(kind)
			if key == "" {
				continue
			}
			if _, seen := by[key]; !seen {
				order = append(order, key)
			}
			by[key] = append(by[key], r.ID)
		}
		for _, key := range order {
			if len(by[key]) >= 2 {
				out = append(out, SharedDefault{Kind: kind, Profile: key, Slots: by[key]})
			}
		}
	}
	return out
}

// MissingDefault is a Slot that is on for new Titles but names no default Profile for a kind of Title, so a new Title of
// that kind could not get a Version in it.
type MissingDefault struct {
	Slot  Slot
	Label string
	Kind  release.Kind
}

// Message words it for an admin, naming the Slot by label and the kind.
func (m MissingDefault) Message() string {
	kind := "Movies"
	if m.Kind == release.KindSeries {
		kind = "Series"
	}
	return m.Label + " has no default Profile for " + kind
}

// MissingDefaults lists every Slot that is on for new Titles and lacks a default for Movies or for Series, in the order of
// the set, Movies before Series within a Slot. Finishing setup needs none (#304).
func MissingDefaults(set []Record) []MissingDefault {
	var out []MissingDefault
	for _, r := range set {
		if !r.OnForNew {
			continue
		}
		for _, kind := range []release.Kind{release.KindMovie, release.KindSeries} {
			if r.Default(kind) == "" {
				out = append(out, MissingDefault{Slot: r.ID, Label: r.Label, Kind: kind})
			}
		}
	}
	return out
}
