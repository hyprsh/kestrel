package release

import (
	"fmt"
	"strings"
)

// Source is where a release was captured from. The numeric order is
// meaningful (QualityFinder compares sources) and mirrors Radarr's
// QualitySource. Sonarr's sources (TV raw, Blu-ray raw) are appended by the
// Series parser; JSON carries the lower-case name, never the number.
type Source int

const (
	SourceUnknown Source = iota
	SourceCAM
	SourceTelesync
	SourceTelecine
	SourceWorkprint
	SourceDVD
	SourceTV
	SourceWebDL
	SourceWebRip
	SourceBluray
)

var sourceNames = []string{"unknown", "cam", "telesync", "telecine", "workprint", "dvd", "tv", "webdl", "webrip", "bluray"}

func (s Source) String() string {
	if s >= 0 && int(s) < len(sourceNames) {
		return sourceNames[s]
	}
	return fmt.Sprintf("source(%d)", int(s))
}

func (s Source) MarshalText() ([]byte, error) { return []byte(s.String()), nil }

func (s *Source) UnmarshalText(b []byte) error {
	for i, n := range sourceNames {
		if strings.EqualFold(n, string(b)) {
			*s = Source(i)
			return nil
		}
	}
	return fmt.Errorf("unknown quality source %q", b)
}

// Modifier refines a Source (Remux, screener, ...).
type Modifier int

const (
	ModifierNone Modifier = iota
	ModifierRegional
	ModifierScreener
	ModifierRawHD
	ModifierBRDisk
	ModifierRemux
)

var modifierNames = []string{"none", "regional", "screener", "rawhd", "brdisk", "remux"}

func (m Modifier) String() string {
	if m >= 0 && int(m) < len(modifierNames) {
		return modifierNames[m]
	}
	return fmt.Sprintf("modifier(%d)", int(m))
}

func (m Modifier) MarshalText() ([]byte, error) { return []byte(m.String()), nil }

func (m *Modifier) UnmarshalText(b []byte) error {
	for i, n := range modifierNames {
		if strings.EqualFold(n, string(b)) {
			*m = Modifier(i)
			return nil
		}
	}
	return fmt.Errorf("unknown quality modifier %q", b)
}

// Resolution is a parsed vertical resolution; the value is the pixel height.
type Resolution int

const (
	ResolutionUnknown Resolution = 0
	Res360p           Resolution = 360
	Res480p           Resolution = 480
	Res540p           Resolution = 540
	Res576p           Resolution = 576
	Res720p           Resolution = 720
	Res1080p          Resolution = 1080
	Res2160p          Resolution = 2160
)

// Quality is one entry of an *arr quality table. ID and Name come from the
// app that produced it: Radarr and Sonarr number their tables differently, so
// the kind that parsed a release decides which table the ID belongs to.
type Quality struct {
	ID         int      `json:"id"`
	Name       string   `json:"name"`
	Source     Source   `json:"source"`
	Resolution int      `json:"resolution"`
	Modifier   Modifier `json:"modifier"`
}

func (q Quality) String() string { return q.Name }

// DetectionSource says where a part of the quality was read from.
type DetectionSource int

const (
	DetectedUnknown DetectionSource = iota
	DetectedName
	DetectedExtension
)

var detectionNames = []string{"unknown", "name", "extension"}

func (d DetectionSource) String() string {
	if d >= 0 && int(d) < len(detectionNames) {
		return detectionNames[d]
	}
	return fmt.Sprintf("detection(%d)", int(d))
}

func (d DetectionSource) MarshalText() ([]byte, error) { return []byte(d.String()), nil }

func (d *DetectionSource) UnmarshalText(b []byte) error {
	for i, n := range detectionNames {
		if strings.EqualFold(n, string(b)) {
			*d = DetectionSource(i)
			return nil
		}
	}
	return fmt.Errorf("unknown detection source %q", b)
}

// Revision is the Proper/Repack/Real state of a release. A plain release is
// version 1; Proper and Repack make it 2.
type Revision struct {
	Version  int  `json:"version"`
	Real     int  `json:"real"`
	IsRepack bool `json:"isRepack"`
}

func (r Revision) String() string {
	s := fmt.Sprintf("v%d", r.Version)
	if r.Real > 0 {
		s += fmt.Sprintf(" Real:%d", r.Real)
	}
	return s
}

// QualityModel is the parsed quality of a release: the quality, its revision
// and, for the parity and scoring stages, where each part was detected.
type QualityModel struct {
	Quality  Quality  `json:"quality"`
	Revision Revision `json:"revision"`

	SourceDetection     DetectionSource `json:"sourceDetection"`
	ResolutionDetection DetectionSource `json:"resolutionDetection"`
	ModifierDetection   DetectionSource `json:"modifierDetection"`
	RevisionDetection   DetectionSource `json:"revisionDetection"`
}

func (q QualityModel) String() string { return q.Quality.String() + " " + q.Revision.String() }

// qualityTable is the ordered list a kind's parser looks qualities up in.
type qualityTable []Quality

// findBySourceAndResolution ports QualityFinder.FindBySourceAndResolution.
func (t qualityTable) findBySourceAndResolution(source Source, resolution int, modifier Modifier) Quality {
	// A perfect three-way match.
	for _, q := range t {
		if q.Source == source && q.Resolution == resolution && q.Modifier == modifier {
			return q
		}
	}

	// Source and modifier match for qualities with unknown resolution.
	var unknownRes []Quality
	for _, q := range t {
		if q.Source == source && q.Resolution == 0 && q.Modifier == modifier && q.ID != 0 {
			unknownRes = append(unknownRes, q)
		}
	}
	if len(unknownRes) == 1 {
		return unknownRes[0]
	}
	for _, q := range unknownRes {
		if q.Source >= source {
			return q
		}
	}

	// Modifier match at the same resolution, nearest source at or above.
	nearest := t.unknown()
	best := Source(1 << 30)
	for _, q := range t {
		if q.Modifier == modifier && q.Resolution == resolution && q.Source >= source && q.Source < best {
			nearest, best = q, q.Source
		}
	}
	return nearest
}

func (t qualityTable) unknown() Quality {
	for _, q := range t {
		if q.ID == 0 {
			return q
		}
	}
	return Quality{}
}
