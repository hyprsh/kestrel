// Package resolution holds the resolution classes of PRD #22 (Settled 2): SD,
// HD and UHD. Pre-Grab scoring classes a parsed height, Probe, Import and
// Adoption class a probed frame size, and a Profile accepts the classes whose
// nominal range lies inside its height bounds.
package resolution

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

// Range is the nominal height range of a class: SD 0-576, HD 720-1080 and UHD
// 2160-2160.
func (c Class) Range() (min, max int) {
	switch c {
	case HD:
		return 720, 1080
	case UHD:
		return 2160, 2160
	default:
		return 0, 576
	}
}

// Within reports whether the class's nominal range lies inside the height
// bounds of a Profile (inclusive).
func (c Class) Within(minHeight, maxHeight int) bool {
	lo, hi := c.Range()
	return lo >= minHeight && hi <= maxHeight
}

// OfSize classes a probed frame size: UHD if width >= 3200 or height >= 1800,
// HD if width >= 1200 or height >= 700, otherwise SD.
func OfSize(width, height int) Class {
	switch {
	case width >= 3200 || height >= 1800:
		return UHD
	case width >= 1200 || height >= 700:
		return HD
	default:
		return SD
	}
}

// OfHeight classes a resolution parsed from a release name: up to 576p is SD,
// 720p to 1080p HD, above that UHD. A height of 0 is unknown and reports
// false.
func OfHeight(height int) (Class, bool) {
	switch {
	case height <= 0:
		return SD, false
	case height <= 576:
		return SD, true
	case height <= 1080:
		return HD, true
	default:
		return UHD, true
	}
}
