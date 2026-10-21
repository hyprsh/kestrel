package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/history"
)

// ListEvents is the Log: kept events newest first, routine ones only on request.
func (s *server) ListEvents(ctx context.Context, r oapi.ListEventsRequestObject) (oapi.ListEventsResponseObject, error) {
	p := r.Params
	f := history.Filter{}
	if p.Kind != nil {
		f.Kinds = kindsOf(*p.Kind)
	}
	if p.ExcludeKind != nil {
		f.ExcludeKinds = kindsOf(*p.ExcludeKind)
	}
	if p.TitleId != nil {
		f.TitleIDs = *p.TitleId
	}
	if p.ExcludeTitleId != nil {
		f.ExcludeTitleIDs = *p.ExcludeTitleId
	}
	var err error
	if f.Slots, err = slotsOf("slot", p.Slot); err != nil {
		return nil, err
	}
	if f.ExcludeSlots, err = slotsOf("exclude_slot", p.ExcludeSlot); err != nil {
		return nil, err
	}
	if p.Routine != nil {
		f.Routine = *p.Routine
	}
	if p.Before != nil {
		f.Before = *p.Before
	}
	if p.Limit != nil {
		f.Limit = *p.Limit
	}
	evs, err := s.history.List(ctx, f)
	if err != nil {
		return nil, err
	}
	out := oapi.EventList{Items: make([]oapi.Event, 0, len(evs))}
	for _, e := range evs {
		item := oapi.Event{
			Id: e.ID, At: e.At, Kind: string(e.Kind), Routine: e.Routine, Message: e.Message,
			TitleId: idPtr(e.TitleID), VersionId: idPtr(e.VersionID), EpisodeId: idPtr(e.EpisodeID),
			GrabId: idPtr(e.GrabID), RequestId: idPtr(e.RequestID),
		}
		if len(e.Data) > 0 {
			var data map[string]any
			if json.Unmarshal(e.Data, &data) == nil {
				item.Data = &data
			}
		}
		out.Items = append(out.Items, item)
	}
	return oapi.ListEvents200JSONResponse(out), nil
}

// slotsOf is a Slot filter's values; field names it in the error.
func slotsOf(field string, slots *[]oapi.Slot) ([]string, error) {
	if slots == nil {
		return nil, nil
	}
	var out []string
	for _, slot := range *slots {
		switch slot {
		case oapi.Standard, oapi.N4k:
		default:
			return nil, invalid(field, "invalid", field+" must be standard or 4k")
		}
		out = append(out, string(slot))
	}
	return out, nil
}

func kindsOf(names []string) []history.Kind {
	out := make([]history.Kind, len(names))
	for i, n := range names {
		out[i] = history.Kind(n)
	}
	return out
}

// ListBlocklist lists the Releases that will never be grabbed again.
func (s *server) ListBlocklist(ctx context.Context, r oapi.ListBlocklistRequestObject) (oapi.ListBlocklistResponseObject, error) {
	var titleID int64
	if r.Params.TitleId != nil {
		titleID = *r.Params.TitleId
	}
	rows, err := s.acquire.Blocklist(ctx, titleID)
	if err != nil {
		return nil, err
	}
	out := oapi.BlocklistList{Items: make([]oapi.BlocklistEntry, 0, len(rows))}
	for _, b := range rows {
		out.Items = append(out.Items, oapi.BlocklistEntry{
			Id: b.ID, ReleaseName: b.ReleaseName, IndexerId: b.IndexerID, Reason: b.Reason, Size: b.Size,
			PublishedAt: b.PublishedAt, CreatedAt: b.CreatedAt, TitleId: idPtr(b.TitleID), GrabId: idPtr(b.GrabID),
		})
	}
	return oapi.ListBlocklist200JSONResponse(out), nil
}

// DeleteBlocklistEntry lets a Release be grabbed again.
func (s *server) DeleteBlocklistEntry(ctx context.Context, r oapi.DeleteBlocklistEntryRequestObject) (oapi.DeleteBlocklistEntryResponseObject, error) {
	if err := s.acquire.Unblock(ctx, r.Id); errors.Is(err, acquire.ErrBlockNotFound) {
		return nil, problem(http.StatusNotFound, "not_found", "no such Blocklist entry")
	} else if err != nil {
		return nil, err
	}
	return oapi.DeleteBlocklistEntry204Response{}, nil
}
