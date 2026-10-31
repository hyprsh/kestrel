package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/requests"
)

// siloSilentPrefix starts the id of a "Silo stopped asking" row; the rest is the Request's id.
const siloSilentPrefix = "silo-silent-"

// siloSilence is how long a Silo Request may go unasked about before it is flagged: Silo's whole
// retry span for a failed Fulfill (10 attempts backing off from 5 minutes to an hour, about six
// hours) plus the 10-minute submission lease (docs/research/silo-events.md, "Cancel after a failed
// Fulfill"). Silo calls CheckStatus for every Target it stores, so a Request past this span has no
// Target and none is coming: Silo gave up, or the requester cancelled it.
const siloSilence = 6*time.Hour + 10*time.Minute

// siloSilentRows are the Needs attention rows for the open Silo Requests Silo stopped asking about:
// a Warning each. Kestrel only flags them; a later Fulfill for the same requester and Title lands on
// the same Request, so ending it is the Operator's call.
func (s *server) siloSilentRows(ctx context.Context) ([]oapi.AttentionRow, error) {
	quiet, err := s.requests.Quiet(ctx, siloSource, s.opts.Clock().Add(-siloSilence))
	if err != nil {
		return nil, err
	}
	rows := make([]oapi.AttentionRow, 0, len(quiet))
	for _, q := range quiet {
		id := strconv.FormatInt(q.ID, 10)
		who := q.RequesterName
		if q.TitleName != "" {
			who = q.TitleName + " for " + who
		}
		query := "status:open source:silo"
		if q.TitleName != "" {
			query += ` "` + strings.ReplaceAll(q.TitleName, `"`, "") + `"`
		}
		rows = append(rows, oapi.AttentionRow{
			Id: siloSilentPrefix + id, Severity: oapi.AttentionRowSeverityWarning, Kind: "silo_silent",
			Message: fmt.Sprintf("Silo stopped asking about the Request for %s. It may have been cancelled in Silo.", who),
			Since:   q.LastAsked.Add(siloSilence), Count: 1,
			Subject: oapi.AttentionSubject{TitleId: idPtr(q.TitleID)},
			Actions: []oapi.AttentionAction{
				{Key: "open", Label: "Open the Request", Method: oapi.GET, Path: "/requests?q=" + url.QueryEscape(query)},
				{
					Key: "end", Label: "End", Method: oapi.POST, Path: "/requests/" + id + "/end",
					Confirm: ptr("End this Request? Silo no longer asks about it. It ends as a rejected Request does; the Title and any files stay."),
				},
				{Key: "dismiss", Label: "Dismiss", Method: oapi.POST, Path: "/attention/" + siloSilentPrefix + id + "/dismiss"},
			},
		})
	}
	return rows, nil
}

// dismissSiloSilent keeps the Request and stops flagging it until Silo asks about it again.
func (s *server) dismissSiloSilent(ctx context.Context, raw string) (oapi.DismissAttentionResponseObject, error) {
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return nil, problem(http.StatusNotFound, "not_found", "no such Needs attention row")
	}
	switch err := s.requests.DismissQuiet(ctx, id); {
	case errors.Is(err, requests.ErrNotFound), errors.Is(err, requests.ErrNotOpen):
		return nil, problem(http.StatusNotFound, "not_found", "no such Needs attention row")
	case err != nil:
		return nil, err
	}
	return oapi.DismissAttention204Response{}, nil
}

func (s *server) EndRequest(ctx context.Context, r oapi.EndRequestRequestObject) (oapi.EndRequestResponseObject, error) {
	req, err := s.requests.End(ctx, r.Id)
	switch {
	case errors.Is(err, requests.ErrNotFound):
		return nil, problem(http.StatusNotFound, "not_found", "no such Request")
	case errors.Is(err, requests.ErrNotOpen):
		return nil, problem(http.StatusConflict, "conflict", "only an open Request can be ended")
	case err != nil:
		return nil, err
	}
	msg := "Request from " + req.RequesterName + " via " + requests.SourceName(req.Source) + " ended by hand"
	if req.Source == siloSource {
		msg += ": Silo stopped asking about it, so it may have been cancelled in Silo"
	}
	s.history.Record(ctx, history.Event{Kind: history.RequestEnded, TitleID: req.TitleID, RequestID: req.ID, Message: msg})
	return oapi.EndRequest204Response{}, nil
}
