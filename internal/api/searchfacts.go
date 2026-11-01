package api

import (
	"context"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/library"
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

// withWantedSearches puts, on each Wanted Slot of the Title rows, what its last search found and when it is next searched
// (the Overview's Wanted list shows them). Slots that are not Wanted are left alone, so a big library costs one query for
// the searches and one per Title with something Wanted.
func (s *server) withWantedSearches(ctx context.Context, rows []oapi.TitleRow) error {
	var ids []int64
	for _, r := range rows {
		for _, sl := range []*oapi.SlotSummary{r.Slots.Standard, r.Slots.N4k} {
			if sl != nil && sl.State == oapi.SlotStateWanted {
				ids = append(ids, sl.VersionId)
			}
		}
	}
	if len(ids) == 0 {
		return nil
	}
	last, err := s.acquire.LastSearches(ctx, ids)
	if err != nil {
		return err
	}
	for _, r := range rows {
		entries := map[int64]*oapi.SlotStateEntry{}
		for i := range r.SlotStates {
			entries[r.SlotStates[i].VersionId] = &r.SlotStates[i]
		}
		var next map[int64]library.NextSearch
		for _, sl := range []*oapi.SlotSummary{r.Slots.Standard, r.Slots.N4k} {
			if sl == nil || sl.State != oapi.SlotStateWanted {
				continue
			}
			if ls, ok := last[sl.VersionId]; ok {
				out := lastSearchToAPI(ls)
				sl.LastSearch = &out
				if e := entries[sl.VersionId]; e != nil {
					e.LastSearch = &out
				}
			}
			if next == nil {
				if next, err = s.library.NextSearches(ctx, r.Id); err != nil {
					return err
				}
			}
			if n, ok := next[sl.VersionId]; ok {
				sl.NextSearchAt = n.Missing
				if e := entries[sl.VersionId]; e != nil {
					e.NextSearchAt = n.Missing
				}
			}
		}
	}
	return nil
}
