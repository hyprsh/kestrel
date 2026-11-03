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

func TestIsLongMissingCountsFromTheRelease(t *testing.T) {
	now := *day("2026-10-18")
	added := *day("2026-10-18") // added today unless a case says otherwise
	cases := []struct {
		name string
		u    Unit
		want bool
	}{
		{"released 91 days ago", Unit{Monitored: true, Released: day("2026-07-19"), AddedAt: *day("2026-07-19")}, true},
		{"released exactly 90 days ago", Unit{Monitored: true, Released: day("2026-07-20"), AddedAt: *day("2026-07-20")}, false},
		{"released yesterday", Unit{Monitored: true, Released: day("2026-10-17"), AddedAt: *day("2026-10-17")}, false},
		{"released years ago and added today is Long Missing at once", Unit{Monitored: true, Released: day("2015-03-01"), AddedAt: added}, true},
		{"released 60 days ago and added today is not yet", Unit{Monitored: true, Released: day("2026-08-19"), AddedAt: added}, false},
		{"filled never", Unit{Monitored: true, HasFile: true, Released: day("2020-01-01"), AddedAt: added}, false},
		{"unmonitored never", Unit{Released: day("2020-01-01"), AddedAt: added}, false},
		{"unreleased never", Unit{Monitored: true, AddedAt: added}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := IsLongMissing(c.u, now); got != c.want {
				t.Fatalf("got %v, want %v", got, c.want)
			}
		})
	}
}

func TestASeriesTotalsLeaveSpecialsOutButAMonitoredWantedSpecialStaysWanted(t *testing.T) {
	now := *day("2026-10-18")
	added := *day("2026-01-01")
	past := day("2025-01-01")
	regular := []Unit{
		{Monitored: true, HasFile: true, Released: past, AddedAt: added},
		{Monitored: true, HasFile: true, Released: past, AddedAt: added},
	}
	with := func(special Unit) []Unit {
		special.Special = true
		return append(append([]Unit{}, regular...), special)
	}
	cases := []struct {
		name        string
		units       []Unit
		state       State
		have, aired int
		cov         Coverage
	}{
		{"an unmonitored Special without a file", with(Unit{Released: past, AddedAt: added}), Filled, 2, 2,
			Coverage{Episodes: 2, Filled: 2}},
		{"a monitored aired Special without a file", with(Unit{Monitored: true, Released: past, AddedAt: added}), Wanted, 2, 2,
			Coverage{Episodes: 2, Filled: 2, Wanted: 1, LongMissing: 1}},
		{"a Special with a file", with(Unit{Monitored: true, HasFile: true, Released: past, AddedAt: added}), Filled, 2, 2,
			Coverage{Episodes: 2, Filled: 2}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if st, _ := SeriesState(c.units, now); st != c.state {
				t.Errorf("state = %s, want %s", st, c.state)
			}
			if have, aired := episodeTotals(c.units, now); have != c.have || aired != c.aired {
				t.Errorf("have/aired = %d/%d, want %d/%d", have, aired, c.have, c.aired)
			}
			if got := coverageOf(c.units, 0, now); *got != c.cov {
				t.Errorf("coverage = %+v, want %+v", *got, c.cov)
			}
		})
	}
}
