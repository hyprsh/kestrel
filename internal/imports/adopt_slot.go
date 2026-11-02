package imports

import (
	"regexp"
	"strings"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/probe"
	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/slot"
)

// episodeCodeRx is the `S01E02` or `S01E02-E03` and ` - ` that precede a Series file's label.
var episodeCodeRx = regexp.MustCompile(`(?i)^S\d+E\d+(?:-E\d+)? - `)

// labelAt is the text of the first bracket at the fixed place of a Slot label
// (ADR 0024): right after `<folder name> - ` in a Movie's file name, and
// right after `<series folder> - SxxEyy - ` in an episode's. base is the file
// name without extension. It is "" when the file does not follow that shape,
// so the same words later in the name, such as `[German]` or `[Remux-2160p]`
// after the label, never pick a Slot.
func labelAt(base, folder string, series bool) string {
	if folder == "" {
		return ""
	}
	prefix := folder + " - "
	if len(base) < len(prefix) || !strings.EqualFold(base[:len(prefix)], prefix) {
		return ""
	}
	rest := base[len(prefix):]
	if series {
		loc := episodeCodeRx.FindStringIndex(rest)
		if loc == nil {
			return ""
		}
		rest = rest[loc[1]:]
	}
	rest, ok := strings.CutPrefix(rest, "[")
	if !ok {
		return ""
	}
	label, _, ok := strings.Cut(rest, "]")
	if !ok {
		return ""
	}
	return label
}

// chooseSlot is a file's Slot. A label, or an alias, that names a Slot picks
// it. Otherwise (no label, or one no Slot has) the first Slot, in order, whose
// default Profile covers the file is the guess, and when none does the first
// Slot is. guessed says the Slot is a guess, for the review to list.
func chooseSlot(set []slot.Record, aliases map[slot.Slot][]string, label string, covers func(slot.Record) bool) (sl slot.Slot, guessed bool) {
	if s, ok := slot.MatchLabel(set, aliases, label); ok {
		return s, false
	}
	for _, r := range set {
		if covers(r) {
			return r.ID, true
		}
	}
	if len(set) > 0 {
		return set[0].ID, true
	}
	return slot.Standard, true
}

// titleFolderOf is the Title folder of an entry: the entry itself when it is
// a folder. A loose file has none, so its label is not read.
func titleFolderOf(en entry) string {
	if en.IsDir {
		return en.Name
	}
	return ""
}

// slotFor is the Slot of a file of the entry. folder is the Title folder whose
// name its own name starts with.
func (a *Adoption) slotFor(e *env, kind library.Kind, folder, base string, info probe.Info) (Slot, bool) {
	covers := func(r slot.Record) bool {
		key := r.Default(release.KindMovie)
		if kind == library.Series {
			key = r.Default(release.KindSeries)
		}
		for _, p := range e.profiles {
			if p.Key == key {
				return a.accepts(e, info.Class())(p)
			}
		}
		return false
	}
	return chooseSlot(e.slots, e.aliases, labelAt(base, folder, kind == library.Series), covers)
}
