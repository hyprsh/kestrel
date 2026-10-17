package probe

import "context"

// Unavailable is the Prober used when no ffprobe is installed: every probe
// fails with ErrNotInstalled, so Imports stall instead of rejecting Releases.
type Unavailable struct{}

// Probe always fails with ErrNotInstalled.
func (Unavailable) Probe(context.Context, string) (Info, error) { return Info{}, ErrNotInstalled }

// Default returns the ffprobe on PATH, or Unavailable when there is none.
func Default() Prober {
	if f, err := NewFFprobe(); err == nil {
		return f
	}
	return Unavailable{}
}
