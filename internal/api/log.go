package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"time"

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
	if f.Slots, err = s.slotsOf(ctx, "slot", p.Slot); err != nil {
		return nil, err
	}
	if f.ExcludeSlots, err = s.slotsOf(ctx, "exclude_slot", p.ExcludeSlot); err != nil {
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
			GrabId: idPtr(e.GrabID), RequestId: idPtr(e.RequestID), Reason: e.Reason, Trigger: triggerOf(e.Trigger),
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

// triggerOf is an event's trigger as the API words it, nil for an entry from before triggers were recorded.
func triggerOf(t history.Trigger) *oapi.EventTrigger {
	if t.IsZero() {
		return nil
	}
	out := oapi.EventTrigger{Kind: string(t.Kind)}
	if t.Actor != "" {
		out.Actor = &t.Actor
	}
	if t.Via != "" {
		out.Via = &t.Via
	}
	return &out
}

// GetEventsSummary is what the Log holds, for its views' counts and its footer.
func (s *server) GetEventsSummary(ctx context.Context, _ oapi.GetEventsSummaryRequestObject) (oapi.GetEventsSummaryResponseObject, error) {
	sum, err := s.history.Summary(ctx)
	if err != nil {
		return nil, err
	}
	out := oapi.EventsSummary{Counts: make([]oapi.EventKindCount, 0, len(sum.Counts)), RoutineDays: int(history.RoutineLife / (24 * time.Hour))}
	for k, n := range sum.Counts {
		out.Counts = append(out.Counts, oapi.EventKindCount{Kind: string(k), Count: n, Routine: history.IsRoutine(k)})
	}
	sort.Slice(out.Counts, func(i, j int) bool { return out.Counts[i].Kind < out.Counts[j].Kind })
	if !sum.Oldest.IsZero() {
		out.Oldest = &sum.Oldest
	}
	return oapi.GetEventsSummary200JSONResponse(out), nil
}

// GetEventsHistogram is the Log's strip: events per bucket of time, by severity.
func (s *server) GetEventsHistogram(ctx context.Context, r oapi.GetEventsHistogramRequestObject) (oapi.GetEventsHistogramResponseObject, error) {
	bucket, days := oapi.GetEventsHistogramParamsBucket("4h"), 7
	if r.Params.Bucket != nil {
		bucket = *r.Params.Bucket
	}
	if r.Params.Days != nil {
		days = *r.Params.Days
	}
	length, ok := map[oapi.GetEventsHistogramParamsBucket]time.Duration{"1h": time.Hour, "4h": 4 * time.Hour, "1d": 24 * time.Hour}[bucket]
	if !ok {
		return nil, invalid("bucket", "invalid", "bucket must be 1h, 4h or 1d")
	}
	if days < 1 || days > 90 {
		return nil, invalid("days", "invalid", "days must be between 1 and 90")
	}
	buckets, err := s.history.Histogram(ctx, length, days)
	if err != nil {
		return nil, err
	}
	out := oapi.EventsHistogram{Bucket: oapi.EventsHistogramBucket(bucket), Buckets: make([]oapi.EventsBucket, 0, len(buckets))}
	for _, b := range buckets {
		out.Buckets = append(out.Buckets, oapi.EventsBucket{At: b.Start, Events: b.Events, Warnings: b.Warnings, Errors: b.Errors})
	}
	return oapi.GetEventsHistogram200JSONResponse(out), nil
}

// slotsOf is a Slot filter's values, each the id of an existing Slot; field names it in the error.
func (s *server) slotsOf(ctx context.Context, field string, slots *[]oapi.SlotId) ([]string, error) {
	if slots == nil {
		return nil, nil
	}
	var out []string
	for _, id := range *slots {
		sl, err := s.slotFromAPI(ctx, id, field)
		if err != nil {
			return nil, err
		}
		out = append(out, sl.Key())
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

// CreateBlocklistEntry blocklists a Release of a manual search.
func (s *server) CreateBlocklistEntry(ctx context.Context, r oapi.CreateBlocklistEntryRequestObject) (oapi.CreateBlocklistEntryResponseObject, error) {
	if r.Body == nil {
		return nil, invalid("body", "required", "a body is required")
	}
	reason := "Blocklisted from a manual search"
	if r.Body.Reason != nil && *r.Body.Reason != "" {
		reason = *r.Body.Reason
	}
	if err := s.acquire.BlockRelease(ctx, r.Body.VersionId, r.Body.ReleaseId, reason); err != nil {
		return nil, grabProblem(err)
	}
	return oapi.CreateBlocklistEntry204Response{}, nil
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
