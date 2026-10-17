package probe_test

import (
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/probe"
)

func TestDurationPlausible(t *testing.T) {
	min := time.Minute
	cases := []struct {
		name              string
		duration, runtime time.Duration
		floor             time.Duration
		want              bool
	}{
		{"full-length movie passes", 90 * min, 90 * min, probe.MovieFloor, true},
		{"movie at exactly half its runtime and above the floor passes", 45 * min, 90 * min, probe.MovieFloor, true},
		{"movie under half its runtime fails", 44 * min, 90 * min, probe.MovieFloor, false},
		{"short film of 30 minutes with a 32-minute runtime passes, the floor does not apply", 30 * min, 32 * min, probe.MovieFloor, true},
		{"movie over half its runtime passes even under the 40-minute floor", 35 * min, 60 * min, probe.MovieFloor, true},
		{"known runtime ignores the floor entirely", 20 * min, 30 * min, probe.MovieFloor, true},
		{"unknown runtime uses the floor alone", 45 * min, 0, probe.MovieFloor, true},
		{"unknown runtime under the floor fails", 39 * min, 0, probe.MovieFloor, false},
		{"20-minute movie with unknown runtime fails the Movie floor", 20 * min, 0, probe.MovieFloor, false},
		{"episode above half runtime and the 10-minute floor passes", 23 * min, 45 * min, probe.EpisodeFloor, true},
		{"episode under the 10-minute floor fails", 9 * min, 0, probe.EpisodeFloor, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := probe.DurationPlausible(tc.duration, tc.runtime, tc.floor); got != tc.want {
				t.Fatalf("DurationPlausible(%v, %v, %v) = %v, want %v", tc.duration, tc.runtime, tc.floor, got, tc.want)
			}
		})
	}
}
