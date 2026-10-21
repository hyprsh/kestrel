package api

import (
	"context"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/api/oapi"
)

// ListGrabs is the Activity screen's history: Grabs newest first with how they
// ended, joined with their Title and Slot like the queue.
func (s *server) ListGrabs(ctx context.Context, r oapi.ListGrabsRequestObject) (oapi.ListGrabsResponseObject, error) {
	p := r.Params
	limit := 100
	if p.Limit != nil {
		limit = *p.Limit
	}
	if limit < 1 || limit > 500 {
		return nil, invalid("limit", "invalid", "limit is between 1 and 500")
	}
	f := acquire.GrabFilter{Stalled: p.Stalled, Limit: limit + 1}
	if p.State != nil {
		for _, st := range *p.State {
			f.States = append(f.States, string(st))
		}
	}
	if p.Since != nil {
		f.Since = *p.Since
	}
	before, err := readCursor(p.Cursor, 1)
	if err != nil {
		return nil, err
	}
	f.Before = before
	list, err := s.acquire.Grabs(ctx, f)
	if err != nil {
		return nil, err
	}
	out := oapi.GrabList{Items: make([]oapi.GrabEntry, 0, len(list))}
	if len(list) > limit {
		list = list[:limit]
		out.NextCursor = cursorOf(list[limit-1].ID)
	}
	titles, err := s.grabTitles(ctx)
	if err != nil {
		return nil, err
	}
	for _, g := range list {
		about := titles.about(g.Grab)
		e := oapi.GrabEntry{
			GrabId: g.ID, TitleId: idPtr(g.TitleID), VersionId: idPtr(g.VersionID), ReleaseName: g.ReleaseName, Indexer: g.IndexerName,
			Size: g.Size, Score: g.Score, IsUpgrade: g.IsUpgrade, State: oapi.GrabEntryState(g.State),
			Failure: strPtr(g.Failure), BlocklistReason: strPtr(g.BlocklistReason), GrabbedAt: g.CreatedAt, UpdatedAt: g.UpdatedAt,
			Title: about.title, HasPoster: about.hasPoster, Year: about.year, Kind: about.kind, Slot: about.slot, Episodes: about.episodes,
		}
		if st := g.Stall; st != nil {
			e.Stalled = &oapi.GrabStall{Reason: st.Reason, Since: st.Since, NextAt: st.NextAt}
		}
		out.Items = append(out.Items, e)
	}
	return oapi.ListGrabs200JSONResponse(out), nil
}
