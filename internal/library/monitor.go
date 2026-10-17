package library

import "time"

// Monitor is a Series' monitoring mode (PRD Settled 10).
type Monitor string

const (
	// MonitorAll monitors every episode, future ones and new seasons included.
	MonitorAll Monitor = "all"
	// MonitorFuture monitors episodes airing today or later, or without an air
	// date, and new seasons.
	MonitorFuture Monitor = "future"
	// MonitorNone monitors nothing; new episodes arrive unmonitored.
	MonitorNone Monitor = "none"
)

// Valid is whether m is one of the three modes.
func (m Monitor) Valid() bool { return m == MonitorAll || m == MonitorFuture || m == MonitorNone }

// MonitorsEpisode is whether the mode monitors an episode of season that airs
// on aired (nil: no air date) when applied at now. Specials (season 0) are
// never monitored automatically. An episode airing today still counts as
// future: air dates carry no time of day.
func (m Monitor) MonitorsEpisode(season int, aired *time.Time, now time.Time) bool {
	if season == 0 {
		return false
	}
	switch m {
	case MonitorAll:
		return true
	case MonitorFuture:
		if aired == nil {
			return true
		}
		today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
		return !aired.Before(today)
	}
	return false
}
