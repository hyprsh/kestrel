package probe

import "strings"

// AudioTrack is one audio stream as probed. Language is canonical (see
// NormalizeLanguage) and empty when the track is untagged.
type AudioTrack struct {
	Index    int
	Codec    string
	Channels int
	Language string
	Title    string
	Default  bool
}

// bibliographicToTerminology maps the ISO 639-2/B codes that some muxers write
// to the ISO 639-2/T codes used everywhere else in Kestrel.
var bibliographicToTerminology = map[string]string{
	"fre": "fra", "ger": "deu", "dut": "nld", "chi": "zho", "cze": "ces",
	"gre": "ell", "per": "fas", "alb": "sqi", "arm": "hye", "baq": "eus",
	"bur": "mya", "geo": "kat", "ice": "isl", "mac": "mkd", "mao": "mri",
	"may": "msa", "rum": "ron", "slo": "slk", "tib": "bod", "wel": "cym",
}

// NormalizeLanguage returns the canonical lowercase ISO 639-2/T code for a
// language tag, or "" for untagged (empty or "und") tracks.
func NormalizeLanguage(tag string) string {
	tag = strings.ToLower(strings.TrimSpace(tag))
	if tag == "" || tag == "und" {
		return ""
	}
	if t, ok := bibliographicToTerminology[tag]; ok {
		return t
	}
	return tag
}

// ResolveLanguages applies the untagged-audio rule (Settled 3). It returns the
// languages to use and whether the probe was inconclusive. The probe is
// inconclusive when no track carries a language, or when every track is English
// or untagged while the parsed languages include a non-English one; then the
// parsed languages stand. Otherwise the probed languages replace the parsed
// ones, deduplicated in track order.
func ResolveLanguages(parsed []string, tracks []AudioTrack) ([]string, bool) {
	var probed []string
	seen := map[string]bool{}
	englishOnly := true
	for _, tr := range tracks {
		if tr.Language == "" {
			continue
		}
		if tr.Language != "eng" {
			englishOnly = false
		}
		if !seen[tr.Language] {
			seen[tr.Language] = true
			probed = append(probed, tr.Language)
		}
	}
	if len(probed) == 0 {
		return parsed, true
	}
	if englishOnly && parsedHasNonEnglish(parsed) {
		return parsed, true
	}
	return probed, false
}

func parsedHasNonEnglish(parsed []string) bool {
	for _, l := range parsed {
		if l != "eng" {
			return true
		}
	}
	return false
}
