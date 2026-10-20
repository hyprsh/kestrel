package api

import (
	"context"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/library"
)

// maxBulkTitles is the spec's maxItems for title_ids.
const maxBulkTitles = 10000

// BulkTitles is POST /titles/bulk: one action over many Titles, answered per
// Title. Each action is a function below that returns one outcome per Title.
func (s *server) BulkTitles(ctx context.Context, r oapi.BulkTitlesRequestObject) (oapi.BulkTitlesResponseObject, error) {
	if r.Body == nil {
		return nil, invalid("body", "required", "a body is required")
	}
	action, err := r.Body.Discriminator()
	if err != nil {
		return nil, invalid("action", "required", "Say which action to take")
	}
	var items []oapi.TitleBulkOutcome
	switch action {
	case "monitor":
		b, err := r.Body.AsTitlesBulkMonitor()
		if err != nil {
			return nil, invalid("body", "invalid", err.Error())
		}
		if err := bulkTitleIDs(b.TitleIds); err != nil {
			return nil, err
		}
		if items, err = s.bulkMonitor(ctx, b); err != nil {
			return nil, err
		}
	default:
		return nil, invalid("action", "invalid", "Unknown action "+action)
	}
	return oapi.BulkTitles200JSONResponse(oapi.TitlesBulkResult{Items: items}), nil
}

func bulkTitleIDs(ids []int64) error {
	if len(ids) == 0 {
		return invalid("title_ids", "required", "Pick at least one Title")
	}
	if len(ids) > maxBulkTitles {
		return invalid("title_ids", "too_many", "At most 10000 Titles at once")
	}
	return nil
}

func bulkChanged(id int64) oapi.TitleBulkOutcome {
	return oapi.TitleBulkOutcome{TitleId: id, Outcome: oapi.TitleBulkOutcomeOutcomeChanged}
}

func bulkSkipped(id int64, reason, message string) oapi.TitleBulkOutcome {
	return oapi.TitleBulkOutcome{TitleId: id, Outcome: oapi.TitleBulkOutcomeOutcomeSkipped, Reason: &reason, Message: &message}
}

// bulkMonitor sets monitored on Movies and the monitoring mode on Series.
func (s *server) bulkMonitor(ctx context.Context, b oapi.TitlesBulkMonitor) ([]oapi.TitleBulkOutcome, error) {
	var mode library.Monitor
	if b.SeriesMonitor != nil {
		mode = library.Monitor(*b.SeriesMonitor)
		if !mode.Valid() {
			return nil, invalid("series_monitor", "invalid", "Monitor all, future or none")
		}
		if !b.Monitored && mode != library.MonitorNone {
			return nil, invalid("series_monitor", "invalid", "Unmonitored Series monitor none")
		}
	}
	results, err := s.library.SetMonitored(ctx, b.TitleIds, b.Monitored, mode)
	if err != nil {
		return nil, err
	}
	out := make([]oapi.TitleBulkOutcome, 0, len(results))
	kick := false
	for _, r := range results {
		switch {
		case r.NotFound:
			out = append(out, bulkSkipped(r.TitleID, "not_found", "No such Title"))
		case !r.Changed:
			out = append(out, bulkSkipped(r.TitleID, "unchanged", "Already as asked"))
		default:
			out = append(out, bulkChanged(r.TitleID))
			kick = kick || b.Monitored
		}
	}
	if kick {
		s.jobs.Kick(jobs.Search) // the Titles monitored again are due now
	}
	return out, nil
}
