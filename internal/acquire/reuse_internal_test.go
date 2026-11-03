package acquire

import (
	"testing"

	"github.com/hyprsh/kestrel/internal/library"
)

func TestAnAnswerCoversTheSameOrANarrowerScopeOnly(t *testing.T) {
	one, two := 1, 2
	whole := askedOf(library.Scope{})
	spread := asked{whole: true, spread: true}
	s1 := askedOf(library.Scope{Season: &one})
	s2 := askedOf(library.Scope{Season: &two})
	e1 := askedOf(library.Scope{Season: &one, EpisodeIDs: []int64{10}})
	e12 := askedOf(library.Scope{Season: &one, EpisodeIDs: []int64{11, 10}})
	for _, tc := range []struct {
		name        string
		answer, ask asked
		want        bool
	}{
		{"whole serves whole", whole, whole, true},
		{"a plain whole answer never serves a season", whole, s1, false},
		{"a plain whole answer never serves episodes", whole, e1, false},
		{"a spread whole answer serves a season", spread, s1, true},
		{"a spread whole answer serves episodes", spread, e1, true},
		{"a spread whole answer serves a plain whole one", spread, whole, true},
		{"a plain whole answer never serves a spread one", whole, spread, false},
		{"a season never serves the whole", s1, whole, false},
		{"a season serves itself", s1, s1, true},
		{"a season never serves another", s1, s2, false},
		{"a season serves its episodes", s1, e1, true},
		{"episodes never serve their season", e1, s1, false},
		{"episodes serve fewer", e12, e1, true},
		{"episodes never serve more", e1, e12, false},
		{"episode ids alone are the whole Series", askedOf(library.Scope{EpisodeIDs: []int64{1}}), whole, true},
	} {
		if got := tc.answer.covers(tc.ask); got != tc.want {
			t.Errorf("%s: covers = %v, want %v", tc.name, got, tc.want)
		}
	}
}
