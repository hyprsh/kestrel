package imports

import (
	"context"

	"github.com/hyprsh/kestrel/internal/library"
)

// placeholders adds a Placeholder Episode (ADR 0013) for each episode a file
// names that the Series has none for, when every such one qualifies (for
// instance an extra episode in a season pack), so the file imports like any
// other. A file naming one that does not qualify adds nothing: Import leaves
// those episodes alone as unknown. It reports false, with the episodes
// recorded as Stalled in out, when the Library could not add them.
func (in *seriesImport) placeholders(ctx context.Context, season int, numbers []int, fileName string, out *Result) bool {
	refs, why := library.UnlistedOf(in.d, in.eps, season, numbers, in.s.clock())
	if len(refs) == 0 || why != library.Qualifies {
		return true
	}
	err := in.s.lib.AddPlaceholders(ctx, in.d.ID, refs)
	var eps []library.Episode
	if err == nil {
		eps, err = in.s.lib.Episodes(ctx, in.d.ID, library.View{Now: in.s.clock()})
	}
	if err != nil {
		for _, r := range refs {
			out.Episodes = append(out.Episodes, EpisodeResult{Season: r.Season, Number: r.Number, Status: Stalled, Reason: stalledBy(err).Reason, File: fileName})
		}
		return false
	}
	in.eps = eps
	for _, ep := range eps {
		in.byRef[[2]int{ep.Season, ep.Number}] = ep
	}
	return true
}
