package probe

import "time"

// Duration floors below which a file is too short to be the whole Title or
// episode, whatever the metadata runtime says (Settled 24 and Import check d).
const (
	MovieFloor   = 40 * time.Minute
	EpisodeFloor = 10 * time.Minute
)

// DurationPlausible reports whether a probed duration is plausible for a
// Title. It must reach half the metadata runtime when the runtime is known,
// and it must reach the floor for the kind. An unknown runtime (zero) leaves
// only the floor.
func DurationPlausible(duration, runtime, floor time.Duration) bool {
	if duration < floor {
		return false
	}
	return runtime <= 0 || duration*2 >= runtime
}
