package acquire

import (
	"context"

	"github.com/hyprsh/kestrel/internal/library"
)

// releaseSeen records that n Releases matched to a Movie with no release date
// anywhere were seen (in RSS or a search), rejected or blocklisted ones
// included: from now on the Movie counts as released. The first sighting is
// the one kept.
func (s *Service) releaseSeen(ctx context.Context, d library.Detail, n int) error {
	if n == 0 || !d.Dateless() || d.ReleaseSeenAt != nil {
		return nil
	}
	return s.lib.MarkReleaseSeen(ctx, d.ID, s.clock())
}

// searchable is whether a Movie Version is searched for what it is missing:
// it is in the state the search is for (Wanted, or Filled for an Upgrade),
// or, for a missing search, it is a Movie with no release date anywhere that
// is still waiting for its first Release to be seen.
func searchable(d library.Detail, v library.Version, want library.State) bool {
	return v.State == want || (want == library.Wanted && v.State == library.Unreleased && d.Dateless())
}
