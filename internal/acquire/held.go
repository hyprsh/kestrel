package acquire

import (
	"encoding/json"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring"
)

// fileHeld is a Movie Version's file as Decide sees it, under the Version's Profile.
func fileHeld(f *library.File, p *scoring.Profile) *Held {
	return held(f.Score, !f.Misfit, f.Original, f.ParsedRelease, p, release.KindMovie)
}

// cellHeld is the file of a Filled episode cell as Decide sees it: a misfit
// never fills a cell.
func cellHeld(c *library.EpisodeCell, p *scoring.Profile) *Held {
	parsed := ""
	if c.File != nil {
		parsed = c.File.ParsedRelease
	}
	return held(c.Score, true, c.File != nil && c.File.Original, parsed, p, release.KindSeries)
}

func held(score *int, fits, original bool, parsed string, p *scoring.Profile, kind release.Kind) *Held {
	h := &Held{Fits: fits, Original: original}
	if score != nil {
		h.Score = *score
	}
	h.Done = fits && !original && score != nil && p != nil && p.AtCutoff(kind, qualityOf(parsed), h.Score)
	return h
}

// qualityOf is the quality name in a file's stored parse; "" when there is none.
func qualityOf(parsed string) string {
	var p struct {
		Quality struct {
			Quality struct {
				Name string `json:"name"`
			} `json:"quality"`
		} `json:"quality"`
	}
	if parsed == "" || json.Unmarshal([]byte(parsed), &p) != nil {
		return ""
	}
	return p.Quality.Quality.Name
}
