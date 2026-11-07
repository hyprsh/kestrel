package scoring

import (
	"bytes"
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/hyprsh/kestrel/internal/release"
)

// UsedProfile is an enabled Profile of the household, by its name, for saying what a TRaSH update changed in it.
type UsedProfile struct {
	Name string
	Spec ProfileSpec
}

// TrashChange is one line of what a TRaSH update changed, in plain words.
type TrashChange struct {
	// Op is added, removed or changed.
	Op string `json:"op"`
	// What is custom_format, score or quality.
	What string `json:"what"`
	// Text says it: "WEB Tier 01: 1700 → 1750 in HD".
	Text string `json:"text"`
	// Subject is the Custom Format or quality the change is about, by name.
	Subject string `json:"subject"`
	// Profiles are the household's Profiles it touches.
	Profiles []string `json:"profiles"`
	// NoEffect marks a quality change the Profiles' own qualities override (ADR 0023).
	NoEffect bool `json:"no_effect,omitempty"`
	// Commits are the TRaSH commits behind it, when they are known.
	Commits []string `json:"commits,omitempty"`
}

// TrashDiff is what a TRaSH update changed in what backs the household's enabled Profiles. Unused counts the
// changes to TRaSH profiles that back none of them.
type TrashDiff struct {
	Changes []TrashChange
	Unused  int
}

// DiffSnapshots says what changed from old to new in the Custom Formats, Scores and qualities that back the used
// Profiles, and how many changes there are to TRaSH profiles none of them uses.
func DiffSnapshots(old, new *Snapshot, used []UsedProfile) TrashDiff {
	mine := newDiffer(old, new)
	inUse := map[release.Kind]map[string]bool{}
	for _, u := range used {
		for _, a := range apps {
			name, ok := BackingProfile(u.Spec, a.kind)
			if !ok {
				continue
			}
			if inUse[a.kind] == nil {
				inUse[a.kind] = map[string]bool{}
			}
			inUse[a.kind][name] = true
			ko := u.Spec.Overlay.kind(a.kind)
			mine.target(u.Name, a.kind, name, func(q []string) []string { return derivedQualities(u.Spec, a.kind, q) }, len(ko.Qualities) > 0)
		}
	}
	rest := newDiffer(old, new)
	for _, a := range apps {
		for _, name := range backingNames(old, new, a.kind) {
			if !inUse[a.kind][name] {
				rest.target(name, a.kind, name, func(q []string) []string { return q }, false)
			}
		}
	}
	rest.skipDefinitions(mine)
	return TrashDiff{Changes: mine.changes(), Unused: len(rest.changes())}
}

func backingNames(old, new *Snapshot, kind release.Kind) []string {
	var out []string
	for _, s := range []*Snapshot{old, new} {
		for name := range s.apps[kind].profiles {
			if !slices.Contains(out, name) {
				out = append(out, name)
			}
		}
	}
	slices.Sort(out)
	return out
}

// differ gathers the changes of several targets (a Profile for one kind), so a change the targets share is one line.
type differ struct {
	old, new *Snapshot
	lines    map[string]*TrashChange
	order    []string
	// defs are the Custom Formats both sets score, by kind and trash_id, to compare their conditions once.
	defs map[string]defTarget
}

type defTarget struct {
	kind     release.Kind
	id       string
	profiles []string
}

func newDiffer(old, new *Snapshot) *differ {
	return &differ{old: old, new: new, lines: map[string]*TrashChange{}, defs: map[string]defTarget{}}
}

func (d *differ) add(key, op, what, subject, profile string, noEffect bool) {
	key = fmt.Sprintf("%s|%t", key, noEffect)
	c := d.lines[key]
	if c == nil {
		c = &TrashChange{Op: op, What: what, Subject: subject, NoEffect: noEffect}
		d.lines[key] = c
		d.order = append(d.order, key)
	}
	if !slices.Contains(c.Profiles, profile) {
		c.Profiles = append(c.Profiles, profile)
	}
}

// target compares one Profile's backing TRaSH profile for a kind. derive turns TRaSH's qualities into the Profile's;
// ownQualities says the Profile sets its own.
func (d *differ) target(label string, kind release.Kind, backing string, derive func([]string) []string, ownQualities bool) {
	od, nd := d.old.apps[kind], d.new.apps[kind]
	ob, nb := od.profiles[backing], nd.profiles[backing]
	switch {
	case ob == nil && nb == nil:
		return
	case ob == nil:
		d.add("profile|"+backing, "added", "profile", backing, label, false)
		return
	case nb == nil:
		d.add("profile|"+backing, "removed", "profile", backing, label, false)
		return
	}
	ofs, nfs := od.formatsFor(ob), nd.formatsFor(nb)
	of, nf := scoresOf(ofs), scoresOf(nfs)
	for _, f := range nfs {
		id := f.cf.id
		o, ok := of[id]
		switch {
		case !ok:
			d.add("cf|"+id, "added", "custom_format", f.cf.name, label, false)
		case o.score != f.score:
			d.add(fmt.Sprintf("score|%s|%d|%d", id, o.score, f.score), "changed", "score", f.cf.name, label, false)
		}
		if ok {
			key := string(kind) + "|" + id
			t := d.defs[key]
			t.kind, t.id = kind, id
			if !slices.Contains(t.profiles, label) {
				t.profiles = append(t.profiles, label)
			}
			d.defs[key] = t
		}
	}
	for _, f := range ofs {
		if _, ok := nf[f.cf.id]; !ok {
			d.add("cf|"+f.cf.id, "removed", "custom_format", f.cf.name, label, false)
		}
	}
	oq, nq := derive(ob.qualities), derive(nb.qualities)
	for _, q := range nq {
		if !slices.Contains(oq, q) {
			d.add("q|"+q, "added", "quality", q, label, ownQualities)
		}
	}
	for _, q := range oq {
		if !slices.Contains(nq, q) {
			d.add("q|"+q, "removed", "quality", q, label, ownQualities)
		}
	}
	keep := func(a, b []string) []string {
		return slices.DeleteFunc(slices.Clone(a), func(q string) bool { return !slices.Contains(b, q) })
	}
	if !slices.Equal(keep(oq, nq), keep(nq, oq)) {
		d.add("order", "changed", "quality", "", label, ownQualities)
	}
}

// skipDefinitions leaves out the Custom Formats o compares already, so a changed one counts once.
func (d *differ) skipDefinitions(o *differ) {
	for key := range o.defs {
		delete(d.defs, key)
	}
}

func scoresOf(fs []scoredFormat) map[string]scoredFormat {
	out := make(map[string]scoredFormat, len(fs))
	for _, f := range fs {
		out[f.cf.id] = f
	}
	return out
}

// changes are the lines, added first, then removed, then changed, each in the order found, with their text.
func (d *differ) changes() []TrashChange {
	keys := slices.Sorted(func(yield func(string) bool) {
		for k := range d.defs {
			if !yield(k) {
				return
			}
		}
	})
	for _, k := range keys {
		t := d.defs[k]
		o, n := d.old.apps[t.kind].cfs[t.id], d.new.apps[t.kind].cfs[t.id]
		if what := conditionChanges(o.raw, n.raw); len(what) > 0 {
			key := "def|" + k
			for _, p := range t.profiles {
				d.add(key, "changed", "custom_format", n.name, p, false)
			}
			d.lines[key+"|false"].Text = n.name + " in " + names(t.profiles) + ": " + strings.Join(what, ", ")
		}
	}
	var out []TrashChange
	for _, op := range []string{"added", "removed", "changed"} {
		for _, k := range d.order {
			c := d.lines[k]
			if c.Op != op {
				continue
			}
			if c.Text == "" {
				c.Text = textOf(k, c)
			}
			out = append(out, *c)
		}
	}
	return out
}

func textOf(key string, c *TrashChange) string {
	in := names(c.Profiles)
	var s string
	switch {
	case c.What == "profile":
		s = "TRaSH profile " + c.Subject + " behind " + in
	case c.What == "custom_format":
		s = "Custom Format " + c.Subject + " in " + in
	case c.What == "score":
		parts := strings.Split(key, "|")
		s = fmt.Sprintf("%s: %s → %s in %s", c.Subject, parts[2], parts[3], in)
	case c.Subject == "":
		s = "Qualities reordered in " + in
	case c.Op == "added":
		s = c.Subject + " added to the qualities of " + in
	default:
		s = c.Subject + " removed from the qualities of " + in
	}
	if c.NoEffect {
		verb := "sets"
		if len(c.Profiles) > 1 {
			verb = "set"
		}
		s += fmt.Sprintf(" (no effect: %s %s its own qualities)", in, verb)
	}
	return s
}

// names joins Profile names: "HD", "HD and 4K", "HD, Any and 4K".
func names(ps []string) string {
	if len(ps) <= 1 {
		return strings.Join(ps, "")
	}
	return strings.Join(ps[:len(ps)-1], ", ") + " and " + ps[len(ps)-1]
}

// conditionChanges says how a Custom Format's conditions changed: "release group FLUX added",
// "condition x265 (HD) now required".
func conditionChanges(old, new []rawSpec) []string {
	label := func(s rawSpec) string {
		if s.Implementation == "ReleaseGroupSpecification" {
			return "release group " + s.Name
		}
		return "condition " + s.Name
	}
	find := func(list []rawSpec, s rawSpec) *rawSpec {
		for i := range list {
			if list[i].Name == s.Name && list[i].Implementation == s.Implementation {
				return &list[i]
			}
		}
		return nil
	}
	var out []string
	for _, n := range new {
		o := find(old, n)
		if o == nil {
			out = append(out, label(n)+" added")
			continue
		}
		if o.Required != n.Required {
			out = append(out, label(n)+map[bool]string{true: " now required", false: " no longer required"}[n.Required])
		}
		if o.Negate != n.Negate {
			out = append(out, label(n)+map[bool]string{true: " now negated", false: " no longer negated"}[n.Negate])
		}
		if !sameJSON(o.Fields, n.Fields) {
			out = append(out, label(n)+" changed")
		}
	}
	for _, o := range old {
		if find(new, o) == nil {
			out = append(out, label(o)+" removed")
		}
	}
	return out
}

func sameJSON(a, b json.RawMessage) bool {
	var ca, cb bytes.Buffer
	if json.Compact(&ca, a) != nil || json.Compact(&cb, b) != nil {
		return bytes.Equal(a, b)
	}
	return bytes.Equal(ca.Bytes(), cb.Bytes())
}
