package api

import (
	"context"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/api/oapi"
)

// withSearches puts, on each Version of a Title, what its last search found and when it is next searched.
func (s *server) withSearches(ctx context.Context, d *oapi.TitleDetail) error {
	ids := make([]int64, len(d.Versions))
	for i, v := range d.Versions {
		ids[i] = v.Id
	}
	last, err := s.acquire.LastSearches(ctx, ids)
	if err != nil {
		return err
	}
	next, err := s.library.NextSearches(ctx, d.Id)
	if err != nil {
		return err
	}
	for i := range d.Versions {
		v := &d.Versions[i]
		if ls, ok := last[v.Id]; ok {
			out := lastSearchToAPI(ls)
			v.LastSearch = &out
		}
		if n, ok := next[v.Id]; ok {
			// A Wanted Version is searched for what it is missing; a Filled one only for an Upgrade.
			at := n.Upgrade
			if v.State == oapi.SlotStateWanted || at == nil {
				if n.Missing != nil {
					at = n.Missing
				}
			}
			v.NextSearchAt = at
		}
	}
	return nil
}

// lastSearchToAPI is a last search as the API tells it.
func lastSearchToAPI(ls acquire.LastSearch) oapi.LastSearch {
	out := oapi.LastSearch{At: ls.At, Releases: ls.Releases, Outcome: oapi.LastSearchOutcome(ls.Outcome), Upgrade: ls.Upgrade, Reasons: make([]oapi.RejectionCount, len(ls.Reasons))}
	for j, r := range ls.Reasons {
		out.Reasons[j] = oapi.RejectionCount{Code: oapi.RejectionCode(r.Code), Count: r.Count, Detail: strPtr(r.Detail)}
	}
	return out
}
