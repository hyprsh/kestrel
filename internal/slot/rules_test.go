package slot_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/slot"
)

func TestCheckLabel(t *testing.T) {
	ok := []string{"Standard", "4K", "Remux", "German dub", "Kids+", "a-b", "Über", "日本語", "x", strings.Repeat("a", 24)}
	for _, l := range ok {
		if err := slot.CheckLabel(l); err != nil {
			t.Errorf("CheckLabel(%q) = %v, want ok", l, err)
		}
	}
	bad := []string{"", " Remux", "Remux ", "Re[mux]", "a/b", "a_b", "a.b", "😀", strings.Repeat("a", 25), "Re\tmux"}
	for _, l := range bad {
		err := slot.CheckLabel(l)
		var re *slot.RuleError
		if !errors.As(err, &re) || re.Conflict || re.Field != "label" {
			t.Errorf("CheckLabel(%q) = %v, want an invalid label error", l, err)
		}
	}
}

func rec(id, label string, onNew bool) slot.Record {
	return slot.Record{ID: slot.Slot(id), Label: label, OnForNew: onNew}
}

func TestCheckSet(t *testing.T) {
	one := []slot.Record{rec("standard", "Standard", true)}
	four := []slot.Record{rec("a", "A", true), rec("b", "B", false), rec("c", "C", false), rec("d", "D", false)}
	cases := []struct {
		name     string
		set      []slot.Record
		want     string // a substring of the error, or "" for none
		conflict bool
	}{
		{"one is enough", one, "", false},
		{"four is the most", four, "", false},
		{"five is too many", append(append([]slot.Record{}, four...), rec("e", "E", false)), "at most 4", false},
		{"none", nil, "at least one Slot", true},
		{"none on for new Titles", []slot.Record{rec("a", "A", false)}, "on for new Titles", true},
		{"duplicate label, any case", []slot.Record{rec("a", "Remux", true), rec("b", "REMUX", false)}, "already used", false},
		{"bad label", []slot.Record{rec("a", "Re[mux", true)}, "only letters", false},
	}
	for _, c := range cases {
		err := slot.CheckSet(c.set)
		if c.want == "" {
			if err != nil {
				t.Errorf("%s: %v", c.name, err)
			}
			continue
		}
		var re *slot.RuleError
		if !errors.As(err, &re) || !strings.Contains(re.Message, c.want) || re.Conflict != c.conflict {
			t.Errorf("%s: got %v (conflict %v), want %q (conflict %v)", c.name, err, re != nil && re.Conflict, c.want, c.conflict)
		}
	}
}

func TestIDFor(t *testing.T) {
	cases := []struct {
		label string
		taken []slot.Slot
		want  slot.Slot
	}{
		{"Standard", nil, "standard"},
		{"4K", nil, "4k"},
		{"German dub", nil, "german-dub"},
		{"Kids+", nil, "kidsplus"},
		{"Über Remux", nil, "über-remux"},
		{"  a  -  b ", nil, "a-b"},
		{"-", nil, "slot"},
		{"Remux", []slot.Slot{"remux"}, "remux-2"},
		{"Remux", []slot.Slot{"remux", "remux-2"}, "remux-3"},
	}
	for _, c := range cases {
		if got := slot.IDFor(c.label, c.taken); got != c.want {
			t.Errorf("IDFor(%q, %v) = %q, want %q", c.label, c.taken, got, c.want)
		}
		if _, ok := slot.Parse(string(c.want)); !ok {
			t.Errorf("IDFor(%q) = %q is not a parseable id", c.label, c.want)
		}
	}
}
