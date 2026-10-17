package probe

import "time"

// Duration floors below which a file is too short to be the whole Title or
// episode, whatever the metadata runtime says (Settled 24 and Import check d).
const (
	MovieFloor   = 40 * time.Minute
	EpisodeFloor = 10 * time.Minute
)

// DurationPlausible reports whether a probed duration is plausible for a
// Title. When the metadata runtime is known, the duration must reach half of
// it; the floor is not consulted. When the runtime is unknown (zero), the
// duration must reach the floor for the kind instead.
func DurationPlausible(duration, runtime, floor time.Duration) bool {
	if runtime > 0 {
		return duration*2 >= runtime
	}
	return duration >= floor
}
