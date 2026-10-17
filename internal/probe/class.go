// Package probe reads a video file's streams with ffprobe and interprets them
// with the pure rules of PRD #22 (Settled 2 and 3).
package probe

import "github.com/hyprsh/kestrel/internal/resolution"

// Class is a resolution class: SD, HD or UHD. It lives in package resolution
// so that scoring can share it; these aliases keep probe's API.
type Class = resolution.Class

const (
	SD  = resolution.SD
	HD  = resolution.HD
	UHD = resolution.UHD
)

// ClassOf classes a probed frame size: UHD if width >= 3200 or height >= 1800,
// HD if width >= 1200 or height >= 700, otherwise SD.
func ClassOf(width, height int) Class { return resolution.OfSize(width, height) }
