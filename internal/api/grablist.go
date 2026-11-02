package api

import (
	"context"
	"strings"
	"time"

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
	var list []acquire.Record
	if gf := newGrabText(p.Q, p.Kind, p.Slot, p.Grab); gf.active() {
		// Titles and Slots live in the library, so the text filters run here on the whole history and the
		// page is cut from what they keep.
		f.Limit = -1
		all, err := s.acquire.Grabs(ctx, f)
		if err != nil {
			return nil, err
		}
		kept, err := s.keepGrabs(ctx, all, gf)
		if err != nil {
			return nil, err
		}
		for _, g := range kept {
			if before == 0 || g.ID < before {
				list = append(list, g)
			}
			if len(list) > limit {
				break
			}
		}
	} else {
		f.Before = before
		if list, err = s.acquire.Grabs(ctx, f); err != nil {
			return nil, err
		}
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
			Title: about.title, HasPoster: about.hasPoster, Year: about.year, Kind: about.kind, Slot: about.slot, Episodes: about.episodes, EpisodeIds: about.episodeIDs,
		}
		if st := g.Stall; st != nil {
			e.Stalled = &oapi.GrabStall{Reason: st.Reason, Since: st.Since, NextAt: st.NextAt}
		}
		out.Items = append(out.Items, e)
	}
	return oapi.ListGrabs200JSONResponse(out), nil
}

// GetGrabsSummary counts the finished Grabs a filter keeps, over all the history.
func (s *server) GetGrabsSummary(ctx context.Context, r oapi.GetGrabsSummaryRequestObject) (oapi.GetGrabsSummaryResponseObject, error) {
	all, err := s.acquire.Grabs(ctx, acquire.GrabFilter{States: []string{"imported", "failed"}, Limit: -1})
	if err != nil {
		return nil, err
	}
	if gf := newGrabText(r.Params.Q, r.Params.Kind, r.Params.Slot, r.Params.Grab); gf.active() {
		if all, err = s.keepGrabs(ctx, all, gf); err != nil {
			return nil, err
		}
	}
	out := oapi.GrabsSummary{}
	var oldest time.Time
	for _, g := range all {
		if g.State == "imported" {
			out.Imported++
		} else {
			out.Failed++
		}
		if oldest.IsZero() || g.UpdatedAt.Before(oldest) {
			oldest = g.UpdatedAt
		}
	}
	if !oldest.IsZero() {
		out.Oldest = &oldest
	}
	return oapi.GetGrabsSummary200JSONResponse(out), nil
}

// grabText is the filters of GET /grabs that look at a Grab's Title and Slot.
type grabText struct {
	words []string
	kinds map[string]bool
	slots map[string]bool
	ids   map[int64]bool
}

func newGrabText(q *string, kinds *[]oapi.TitleKind, slots *[]oapi.SlotId, ids *[]int64) grabText {
	var g grabText
	if q != nil {
		g.words = strings.Fields(strings.ToLower(*q))
	}
	if kinds != nil && len(*kinds) > 0 {
		g.kinds = map[string]bool{}
		for _, k := range *kinds {
			g.kinds[string(k)] = true
		}
	}
	if slots != nil && len(*slots) > 0 {
		g.slots = map[string]bool{}
		for _, sl := range *slots {
			g.slots[string(sl)] = true
		}
	}
	if ids != nil && len(*ids) > 0 {
		g.ids = map[int64]bool{}
		for _, id := range *ids {
			g.ids[id] = true
		}
	}
	return g
}

func (g grabText) active() bool {
	return len(g.words) > 0 || g.kinds != nil || g.slots != nil || g.ids != nil
}

// keepGrabs keeps, in order, the Grabs that pass every filter in g: each word is found in the Title's name,
// the Release name or the indexer; the kind and Slot are one of the asked ones.
func (s *server) keepGrabs(ctx context.Context, list []acquire.Record, g grabText) ([]acquire.Record, error) {
	type titleInfo struct{ name, kind string }
	titles := map[int64]titleInfo{}
	if len(g.words) > 0 || g.kinds != nil {
		named, err := s.library.Names(ctx)
		if err != nil {
			return nil, err
		}
		for _, n := range named {
			info := titleInfo{kind: string(n.Kind)}
			if len(n.Names) > 0 {
				info.name = strings.ToLower(n.Names[0])
			}
			titles[n.ID] = info
		}
	}
	slots := map[int64]string{}
	out := make([]acquire.Record, 0, len(list))
	for _, r := range list {
		if g.ids != nil && !g.ids[r.ID] {
			continue
		}
		t, known := titles[r.TitleID]
		if g.kinds != nil && (!known || !g.kinds[t.kind]) {
			continue
		}
		if g.slots != nil {
			sl, seen := slots[r.VersionID]
			if !seen {
				if v, err := s.library.GetVersion(ctx, r.VersionID); err == nil {
					sl = string(slotToAPI(v.Slot))
				}
				slots[r.VersionID] = sl
			}
			if !g.slots[sl] {
				continue
			}
		}
		hay := []string{t.name, strings.ToLower(r.ReleaseName), strings.ToLower(r.IndexerName)}
		if !g.wordsFound(hay) {
			continue
		}
		out = append(out, r)
	}
	return out, nil
}

func (g grabText) wordsFound(hay []string) bool {
	for _, w := range g.words {
		found := false
		for _, h := range hay {
			if strings.Contains(h, w) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}
