package acquire

import "github.com/hyprsh/kestrel/internal/library"

// fileHeld is a Movie Version's file as Decide sees it.
func fileHeld(f *library.File) *Held {
	return held(f.Score, !f.Misfit, f.Original)
}

// cellHeld is the file of a Filled episode cell as Decide sees it: a misfit
// never fills a cell.
func cellHeld(c *library.EpisodeCell) *Held {
	return held(c.Score, true, c.File != nil && c.File.Original)
}

func held(score *int, fits, original bool) *Held {
	h := &Held{Fits: fits, Original: original}
	if score != nil {
		h.Score = *score
	}
	return h
}
