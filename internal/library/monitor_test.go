package library

import (
	"testing"
	"time"
)

func TestMonitorsEpisode(t *testing.T) {
	now := time.Date(2026, 10, 18, 15, 30, 0, 0, time.UTC)
	cases := []struct {
		name   string
		mode   Monitor
		season int
		aired  *time.Time
		want   bool
	}{
		{"all: aired", MonitorAll, 1, day("2020-01-01"), true},
		{"all: future", MonitorAll, 1, day("2030-01-01"), true},
		{"all: no air date", MonitorAll, 2, nil, true},
		{"all: never specials", MonitorAll, 0, day("2020-01-01"), false},
		{"future: aired", MonitorFuture, 1, day("2020-01-01"), false},
		{"future: aired yesterday", MonitorFuture, 1, day("2026-10-17"), false},
		{"future: airs today", MonitorFuture, 1, day("2026-10-18"), true},
		{"future: airs later", MonitorFuture, 1, day("2030-01-01"), true},
		{"future: no air date", MonitorFuture, 1, nil, true},
		{"future: never specials", MonitorFuture, 0, day("2030-01-01"), false},
		{"none: future", MonitorNone, 1, day("2030-01-01"), false},
		{"none: aired", MonitorNone, 1, day("2020-01-01"), false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.mode.MonitorsEpisode(c.season, c.aired, now); got != c.want {
				t.Fatalf("got %v, want %v", got, c.want)
			}
		})
	}
}
