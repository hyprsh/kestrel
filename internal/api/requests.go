package api

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"strconv"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/requests"
)

func requestToAPI(r requests.Request) oapi.Request {
	out := oapi.Request{
		Id: r.ID, Source: r.Source, SourceRequestId: r.SourceRequestID, Outcome: oapi.RequestOutcome(r.Outcome),
		Requester: oapi.Requester{Id: r.RequesterID, Name: r.RequesterName}, CreatedAt: r.CreatedAt,
		Seasons: append([]int{}, r.Seasons...), Slots: make([]oapi.RequestSlot, 0, len(r.Slots)),
	}
	if r.TitleID != 0 {
		out.TitleId = &r.TitleID
	}
	if r.Reason != "" {
		reason := oapi.RequestRejectReason(r.Reason)
		out.RejectReason = &reason
	}
	for _, sl := range r.Slots {
		o := oapi.RequestSlot{Slot: slotToAPI(sl.Slot), Profile: strPtr(sl.Profile), Status: oapi.RequestSlotStatus(sl.Status), StatusLabel: sl.Label}
		if sl.VersionID != 0 {
			id := sl.VersionID
			o.VersionId = &id
		}
		if d := sl.Download; d != nil {
			o.Download = &oapi.RequestDownload{Phase: d.Phase, BytesLeft: d.BytesLeft}
			if d.ETA > 0 {
				secs := int(d.ETA.Seconds())
				o.Download.Eta = &secs
			}
		}
		out.Slots = append(out.Slots, o)
	}
	return out
}

func (s *server) CreateRequest(ctx context.Context, r oapi.CreateRequestRequestObject) (oapi.CreateRequestResponseObject, error) {
	if r.Body == nil {
		return nil, invalid("body", "required", "a body is required")
	}
	b := r.Body
	in := requests.Input{
		Source: b.Source, SourceRequestID: b.SourceRequestId, RequesterID: b.Requester.Id, RequesterName: b.Requester.Name,
		Kind: library.Kind(b.Title.Kind), IMDbID: deref(b.Title.ImdbId),
	}
	if b.Title.TmdbId != nil {
		in.TMDBID = *b.Title.TmdbId
	}
	if b.Title.TvdbId != nil {
		in.TVDBID = *b.Title.TvdbId
	}
	for _, sl := range b.Slots {
		in.Slots = append(in.Slots, requests.SlotInput{Slot: slotFromAPI(sl.Slot), Profile: deref(sl.Profile)})
	}
	if b.Seasons != nil {
		in.Seasons = append([]int{}, *b.Seasons...)
	}
	res, err := s.requests.Submit(ctx, in)
	var ve *requests.ValidationError
	switch {
	case errors.As(err, &ve):
		return nil, invalid(ve.Field, ve.Code, ve.Message)
	case errors.Is(err, requests.ErrNoRootFolder):
		return nil, problem(http.StatusUnprocessableEntity, "validation", "Set a Root folder in Settings first")
	case err != nil:
		return nil, metaProblem(err)
	}
	if res.SearchDue {
		s.jobs.Kick(jobs.Search) // search at once: the new Versions are due now
	}
	if !res.Created {
		return oapi.CreateRequest200JSONResponse(requestToAPI(res.Request)), nil
	}
	return oapi.CreateRequest201JSONResponse(requestToAPI(res.Request)), nil
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func (s *server) GetRequest(ctx context.Context, r oapi.GetRequestRequestObject) (oapi.GetRequestResponseObject, error) {
	req, err := s.requests.Get(ctx, r.Id)
	if errors.Is(err, requests.ErrNotFound) {
		return nil, problem(http.StatusNotFound, "not_found", "no such Request")
	}
	if err != nil {
		return nil, err
	}
	return oapi.GetRequest200JSONResponse(requestToAPI(req)), nil
}

func (s *server) ListRequests(ctx context.Context, r oapi.ListRequestsRequestObject) (oapi.ListRequestsResponseObject, error) {
	p := r.Params
	limit := 100
	if p.Limit != nil {
		limit = *p.Limit
	}
	if limit < 1 || limit > 500 {
		return nil, invalid("limit", "invalid", "limit is between 1 and 500")
	}
	f := requests.Filter{Limit: limit + 1}
	if p.Id != nil && len(*p.Id) > 0 {
		if len(*p.Id) > 100 {
			return nil, invalid("id", "too_many", "Read at most 100 Requests at once")
		}
		f.IDs = *p.Id
	}
	if p.Source != nil {
		f.Source = *p.Source
	}
	if p.TitleId != nil {
		f.TitleID = *p.TitleId
	}
	if p.Cursor != nil && *p.Cursor != "" {
		raw, err := base64.RawURLEncoding.DecodeString(*p.Cursor)
		n, convErr := strconv.ParseInt(string(raw), 10, 64)
		if err != nil || convErr != nil || n <= 0 {
			return nil, invalid("cursor", "invalid", "The cursor is not one this server gave out")
		}
		f.Before = n
	}
	list, err := s.requests.List(ctx, f)
	if err != nil {
		return nil, err
	}
	out := oapi.RequestList{Items: []oapi.Request{}}
	if len(f.IDs) == 0 && len(list) > limit {
		list = list[:limit]
		cursor := base64.RawURLEncoding.EncodeToString([]byte(strconv.FormatInt(list[limit-1].ID, 10)))
		out.NextCursor = &cursor
	}
	for _, req := range list {
		out.Items = append(out.Items, requestToAPI(req))
	}
	return oapi.ListRequests200JSONResponse(out), nil
}

// origins fills a Title detail's "Requested by <name> via <source>" rows.
func (s *server) origins(ctx context.Context, d *oapi.TitleDetail) error {
	list, err := s.requests.OriginsOf(ctx, d.Id)
	if err != nil {
		return err
	}
	for _, o := range list {
		d.Requests = append(d.Requests, oapi.RequestOrigin{Id: o.ID, Source: o.Source, RequesterName: o.RequesterName, CreatedAt: o.CreatedAt})
	}
	return nil
}
