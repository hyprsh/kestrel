package library

import (
	"testing"
	"time"
)

func day(s string) *time.Time {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		panic(err)
	}
	return &t
}

func sameTime(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.Equal(*b)
}

func TestStateAt(t *testing.T) {
	now := *day("2026-10-18")
	added := *day("2026-01-01")
	cases := []struct {
		name  string
		u     Unit
		state State
		since *time.Time
	}{
		{"file wins over everything", Unit{Monitored: false, HasFile: true, Released: day("2030-01-01"), AddedAt: added}, Filled, nil},
		{"unmonitored without a file", Unit{Monitored: false, Released: day("2020-01-01"), AddedAt: added}, Unmonitored, nil},
		{"no release date is unreleased", Unit{Monitored: true, AddedAt: added}, Unreleased, nil},
		{"future release is unreleased", Unit{Monitored: true, Released: day("2026-10-19"), AddedAt: added}, Unreleased, nil},
		{"released today is wanted since today", Unit{Monitored: true, Released: day("2026-10-18"), AddedAt: added}, Wanted, day("2026-10-18")},
		{"released before the add is wanted since the add", Unit{Monitored: true, Released: day("2020-05-05"), AddedAt: added}, Wanted, day("2026-01-01")},
		{"released after the add is wanted since the release", Unit{Monitored: true, Released: day("2026-06-01"), AddedAt: added}, Wanted, day("2026-06-01")},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			st, since := StateAt(c.u, now)
			if st != c.state || !sameTime(since, c.since) {
				t.Fatalf("got %s since %v, want %s since %v", st, since, c.state, c.since)
			}
		})
	}
}

func TestIsLongMissing(t *testing.T) {
	now := *day("2026-10-18")
	cases := []struct {
		name  string
		st    State
		since *time.Time
		want  bool
	}{
		{"wanted 91 days", Wanted, day("2026-07-19"), true},
		{"wanted exactly 90 days", Wanted, day("2026-07-20"), false},
		{"wanted yesterday", Wanted, day("2026-10-17"), false},
		{"filled never", Filled, day("2020-01-01"), false},
		{"no since", Wanted, nil, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := IsLongMissing(c.st, c.since, now); got != c.want {
				t.Fatalf("got %v, want %v", got, c.want)
			}
		})
	}
}

func TestSeriesState(t *testing.T) {
	now := *day("2026-10-18")
	added := *day("2026-01-01")
	past, future := day("2025-01-01"), day("2027-01-01")
	ep := func(monitored, file bool, aired *time.Time) Unit {
		return Unit{Monitored: monitored, HasFile: file, Released: aired, AddedAt: added}
	}
	cases := []struct {
		name  string
		units []Unit
		state State
		since *time.Time
	}{
		{"no episodes", nil, Unmonitored, nil},
		{"nothing monitored and nothing held", []Unit{ep(false, false, past)}, Unmonitored, nil},
		{"a missing aired episode makes it wanted", []Unit{ep(true, true, past), ep(true, false, past)}, Wanted, day("2026-01-01")},
		{"wanted since is the earliest", []Unit{ep(true, false, day("2026-05-05")), ep(true, false, day("2026-03-03"))}, Wanted, day("2026-03-03")},
		{"every aired episode held, more to come", []Unit{ep(true, true, past), ep(true, false, future)}, Filled, nil},
		{"only unaired episodes", []Unit{ep(true, false, future), ep(true, false, nil)}, Unreleased, nil},
		{"unmonitored missing episodes do not make it wanted", []Unit{ep(true, true, past), ep(false, false, past)}, Filled, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			st, since := SeriesState(c.units, now)
			if st != c.state || !sameTime(since, c.since) {
				t.Fatalf("got %s since %v, want %s since %v", st, since, c.state, c.since)
			}
		})
	}
}
