package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/plugin"
)

// stalledRowPrefix starts the id of every Stalled Imports row; the rest is the reason.
const stalledRowPrefix = "stalled-"

// stalledRows are the Stalled Imports rows of Needs attention: one Warning per
// reason, so twenty Imports stalled by a full disk are one row with "Retry all".
func (s *server) stalledRows(ctx context.Context) ([]oapi.AttentionRow, error) {
	stalled, err := s.acquire.Stalled(ctx)
	if err != nil {
		return nil, err
	}
	var order []string
	byReason := map[string][]acquire.StalledImport{}
	for _, st := range stalled {
		if _, seen := byReason[st.Reason]; !seen {
			order = append(order, st.Reason)
		}
		byReason[st.Reason] = append(byReason[st.Reason], st)
	}
	rows := make([]oapi.AttentionRow, 0, len(order))
	for _, reason := range order {
		group := byReason[reason]
		row := oapi.AttentionRow{
			Id: stalledRowPrefix + reason, Severity: oapi.AttentionRowSeverityWarning, Kind: "stalled_imports",
			Since: group[0].Since, Count: len(group), Subject: oapi.AttentionSubject{},
		}
		for _, g := range group {
			row.Since = earlier(row.Since, g.Since)
		}
		if len(group) == 1 {
			g := group[0]
			row.Message = fmt.Sprintf("Import of %s stalled · %s", g.ReleaseName, reason)
			row.Subject = oapi.AttentionSubject{TitleId: idPtr(g.TitleID), VersionId: idPtr(g.VersionID), GrabId: idPtr(g.ID)}
			row.Actions = []oapi.AttentionAction{
				{Key: "retry", Label: "Retry now", Method: oapi.POST, Path: fmt.Sprintf("/grabs/%d/retry-import", g.ID)},
				{
					Key: "discard", Label: "Discard", Method: oapi.POST, Path: fmt.Sprintf("/grabs/%d/discard", g.ID),
					Confirm: ptr("Discard this Grab? Its downloaded files are deleted and the Version is searched for again."),
				},
				stalledLog,
			}
		} else {
			row.Message = fmt.Sprintf("%d Imports stalled · %s", len(group), reason)
			body := map[string]any{"reason": reason}
			row.Actions = []oapi.AttentionAction{
				{Key: "retry", Label: "Retry all", Method: oapi.POST, Path: "/stalled-imports/retry", Body: &body},
				{
					Key: "discard", Label: "Discard all", Method: oapi.POST, Path: "/stalled-imports/discard", Body: &body,
					Confirm: ptr(fmt.Sprintf("Discard %d Grabs? Their downloaded files are deleted and the Versions are searched for again.", len(group))),
				},
				stalledLog,
			}
		}
		rows = append(rows, row)
	}
	return rows, nil
}

// stalledLog shows each time an Import stalled, with why.
var stalledLog = showInLog("kind:import_stalled")

func ptr[T any](v T) *T { return &v }

func (s *server) RetryGrabImport(ctx context.Context, r oapi.RetryGrabImportRequestObject) (oapi.RetryGrabImportResponseObject, error) {
	if err := s.acquire.RetryImport(ctx, r.Id); err != nil {
		return nil, stalledProblem(err)
	}
	s.jobs.Kick(jobs.Import)
	return oapi.RetryGrabImport204Response{}, nil
}

func (s *server) DiscardGrab(ctx context.Context, r oapi.DiscardGrabRequestObject) (oapi.DiscardGrabResponseObject, error) {
	if err := s.acquire.Discard(ctx, r.Id); err != nil {
		return nil, stalledProblem(err)
	}
	return oapi.DiscardGrab204Response{}, nil
}

func (s *server) RetryStalledImports(ctx context.Context, r oapi.RetryStalledImportsRequestObject) (oapi.RetryStalledImportsResponseObject, error) {
	if _, err := s.acquire.RetryStalled(ctx, reasonOf(r.Body)); err != nil {
		return nil, err
	}
	s.jobs.Kick(jobs.Import)
	return oapi.RetryStalledImports204Response{}, nil
}

func (s *server) DiscardStalledImports(ctx context.Context, r oapi.DiscardStalledImportsRequestObject) (oapi.DiscardStalledImportsResponseObject, error) {
	if _, err := s.acquire.DiscardStalled(ctx, reasonOf(r.Body)); err != nil {
		return nil, stalledProblem(err)
	}
	return oapi.DiscardStalledImports204Response{}, nil
}

func reasonOf(b *oapi.StalledImportsSelect) string {
	if b == nil || b.Reason == nil {
		return ""
	}
	return *b.Reason
}

// stalledProblem maps what retrying or discarding a stalled Import can fail with.
func stalledProblem(err error) error {
	var pe *plugin.Error
	switch {
	case errors.Is(err, acquire.ErrGrabNotFound):
		return problem(http.StatusNotFound, "not_found", "no such stalled Import")
	case errors.As(err, &pe):
		return problem(http.StatusBadGateway, "upstream_unavailable", "The download client failed: "+pe.Message)
	}
	return err
}

func earlier(a, b time.Time) time.Time {
	if b.Before(a) {
		return b
	}
	return a
}
