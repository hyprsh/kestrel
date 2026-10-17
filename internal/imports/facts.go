package imports

import (
	"encoding/json"

	"github.com/hyprsh/kestrel/internal/probe"
	"github.com/hyprsh/kestrel/internal/release"
)

// LanguageName is the English name of a canonical language code, or the code
// itself when Kestrel has no name for it.
func LanguageName(code string) string {
	if n, ok := languageNames[code]; ok {
		return n
	}
	return code
}

// Facts reads the quality name and the probed audio languages (English names,
// in track order) off the JSON snapshots stored on a file. Both are empty
// when a snapshot is missing or unreadable.
func Facts(parsedJSON, probeJSON string) (quality string, languages []string) {
	languages = []string{}
	var p release.ParsedRelease
	if json.Unmarshal([]byte(parsedJSON), &p) == nil {
		quality = p.Quality.Quality.Name
	}
	var info probe.Info
	if json.Unmarshal([]byte(probeJSON), &info) == nil {
		seen := map[string]bool{}
		for _, a := range info.Audio {
			if a.Language != "" && !seen[a.Language] {
				seen[a.Language] = true
				languages = append(languages, LanguageName(a.Language))
			}
		}
	}
	return quality, languages
}
