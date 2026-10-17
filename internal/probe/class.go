// Package probe reads a video file's streams with ffprobe and interprets them
// with the pure rules of PRD #22 (Settled 2 and 3).
package probe

// Class is a resolution class: SD, HD or UHD.
type Class int

const (
	SD Class = iota
	HD
	UHD
)

func (c Class) String() string {
	switch c {
	case HD:
		return "HD"
	case UHD:
		return "UHD"
	default:
		return "SD"
	}
}

// ClassOf classes a probed frame size: UHD if width >= 3200 or height >= 1800,
// HD if width >= 1200 or height >= 700, otherwise SD.
func ClassOf(width, height int) Class {
	switch {
	case width >= 3200 || height >= 1800:
		return UHD
	case width >= 1200 || height >= 700:
		return HD
	default:
		return SD
	}
}
