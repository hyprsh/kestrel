package api

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/health"
	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/slot"
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
	ids, err := bulkTitleIDs(r.Body)
	if err != nil {
		return nil, err
	}
	var items []oapi.TitleBulkOutcome
	switch action {
	case "monitor":
		items, err = bulkArm(r.Body.AsTitlesBulkMonitor, func(b oapi.TitlesBulkMonitor) ([]oapi.TitleBulkOutcome, error) {
			return s.bulkMonitor(ctx, ids, b)
		})
	case "switch_profile":
		items, err = bulkArm(r.Body.AsTitlesBulkSwitchProfile, func(b oapi.TitlesBulkSwitchProfile) ([]oapi.TitleBulkOutcome, error) {
			return s.bulkSwitchProfile(ctx, ids, b)
		})
	case "add_version":
		items, err = bulkArm(r.Body.AsTitlesBulkAddVersion, func(b oapi.TitlesBulkAddVersion) ([]oapi.TitleBulkOutcome, error) {
			return s.bulkAddVersion(ctx, ids, b)
		})
	case "remove_version":
		items, err = bulkArm(r.Body.AsTitlesBulkRemoveVersion, func(b oapi.TitlesBulkRemoveVersion) ([]oapi.TitleBulkOutcome, error) {
			return s.bulkRemoveVersion(ctx, ids, b)
		})
	case "search":
		items, err = s.bulkSearch(ctx, ids)
	case "refresh":
		items, err = s.bulkRefresh(ctx, ids)
	case "freeze":
		items, err = bulkArm(r.Body.AsTitlesBulkFreeze, func(b oapi.TitlesBulkFreeze) ([]oapi.TitleBulkOutcome, error) {
			return s.bulkFreeze(ctx, ids, b.Frozen)
		})
	case "remove":
		items, err = bulkArm(r.Body.AsTitlesBulkRemove, func(b oapi.TitlesBulkRemove) ([]oapi.TitleBulkOutcome, error) {
			return s.bulkRemove(ctx, ids, b.DeleteFiles != nil && *b.DeleteFiles)
		})
	default:
		return nil, invalid("action", "invalid", "Unknown action "+action)
	}
	if err != nil {
		return nil, err
	}
	return oapi.BulkTitles200JSONResponse(oapi.TitlesBulkResult{Items: items}), nil
}

// bulkArm decodes the action's parameters and runs it.
func bulkArm[T any](as func() (T, error), run func(T) ([]oapi.TitleBulkOutcome, error)) ([]oapi.TitleBulkOutcome, error) {
	b, err := as()
	if err != nil {
		return nil, invalid("body", "invalid", err.Error())
	}
	return run(b)
}

// bulkTitleIDs reads title_ids, which every action has, with each id once in
// the order given.
func bulkTitleIDs(body *oapi.TitlesBulk) ([]int64, error) {
	raw, err := body.MarshalJSON()
	if err != nil {
		return nil, invalid("body", "invalid", err.Error())
	}
	var common struct {
		TitleIDs []int64 `json:"title_ids"`
	}
	if err := json.Unmarshal(raw, &common); err != nil {
		return nil, invalid("title_ids", "invalid", "title_ids is a list of Title ids")
	}
	if len(common.TitleIDs) == 0 {
		return nil, invalid("title_ids", "required", "Pick at least one Title")
	}
	if len(common.TitleIDs) > maxBulkTitles {
		return nil, invalid("title_ids", "too_many", "At most 10000 Titles at once")
	}
	seen := make(map[int64]bool, len(common.TitleIDs))
	ids := common.TitleIDs[:0]
	for _, id := range common.TitleIDs {
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	return ids, nil
}

func bulkChanged(id int64) oapi.TitleBulkOutcome {
	return oapi.TitleBulkOutcome{TitleId: id, Outcome: oapi.TitleBulkOutcomeOutcomeChanged}
}

func bulkSkipped(id int64, reason, message string) oapi.TitleBulkOutcome {
	return oapi.TitleBulkOutcome{TitleId: id, Outcome: oapi.TitleBulkOutcomeOutcomeSkipped, Reason: &reason, Message: &message}
}

func bulkNotFound(id int64) oapi.TitleBulkOutcome {
	return bulkSkipped(id, "not_found", "No such Title")
}

func bulkUnchanged(id int64) oapi.TitleBulkOutcome {
	return bulkSkipped(id, "unchanged", "Already as asked")
}

func bulkNoVersion(id int64, sl slot.Slot) oapi.TitleBulkOutcome {
	return bulkSkipped(id, "no_version", "Has no "+sl.Name()+" Version")
}

// bulkFailed logs why one Title's change failed; the others go on.
func (s *server) bulkFailed(id int64, err error) oapi.TitleBulkOutcome {
	s.opts.Logger.Error("bulk change of a Title failed", "title_id", id, "err", err)
	reason, message := "internal", "The change failed"
	return oapi.TitleBulkOutcome{TitleId: id, Outcome: oapi.TitleBulkOutcomeOutcomeFailed, Reason: &reason, Message: &message}
}

// bulkRows is the Library's rows by Title id, read once for a bulk call.
func (s *server) bulkRows(ctx context.Context) (map[int64]library.Row, error) {
	view, err := s.view(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.library.List(ctx, view, library.Filter{})
	if err != nil {
		return nil, err
	}
	out := make(map[int64]library.Row, len(rows))
	for _, r := range rows {
		out[r.ID] = r
	}
	return out, nil
}

// bulkSlot reads the action's Slot and, given a Profile, checks the Profile
// can fill it: a wrong one refuses the whole call.
func (s *server) bulkSlot(ctx context.Context, sl oapi.Slot, profile *string) (slot.Slot, error) {
	out, err := slotFromAPI(sl, "slot")
	if err != nil {
		return out, err
	}
	if profile != nil {
		err = s.checkProfile(ctx, *profile, out)
	}
	return out, err
}

// bulkMonitor sets monitored on Movies and the monitoring mode on Series.
func (s *server) bulkMonitor(ctx context.Context, ids []int64, b oapi.TitlesBulkMonitor) ([]oapi.TitleBulkOutcome, error) {
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
	results, err := s.library.SetMonitored(ctx, ids, b.Monitored, mode)
	if err != nil {
		return nil, err
	}
	out := make([]oapi.TitleBulkOutcome, 0, len(results))
	kick := false
	for _, r := range results {
		switch {
		case r.NotFound:
			out = append(out, bulkNotFound(r.TitleID))
		case !r.Changed:
			out = append(out, bulkUnchanged(r.TitleID))
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

// bulkSwitchProfile moves each Title's Version in the Slot to the Profile.
func (s *server) bulkSwitchProfile(ctx context.Context, ids []int64, b oapi.TitlesBulkSwitchProfile) ([]oapi.TitleBulkOutcome, error) {
	sl, err := s.bulkSlot(ctx, b.Slot, &b.Profile)
	if err != nil {
		return nil, err
	}
	rows, err := s.bulkRows(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]oapi.TitleBulkOutcome, 0, len(ids))
	kick := false
	for _, id := range ids {
		row, ok := rows[id]
		v := row.Slots[sl]
		switch {
		case !ok:
			out = append(out, bulkNotFound(id))
		case v == nil:
			out = append(out, bulkNoVersion(id, sl))
		case v.Profile == b.Profile:
			out = append(out, bulkUnchanged(id))
		default:
			if err := s.library.SetProfile(ctx, v.VersionID, b.Profile); err != nil {
				out = append(out, s.bulkFailed(id, err))
				continue
			}
			if err := s.imports.Rescore(ctx, id, v.VersionID); err != nil {
				out = append(out, s.bulkFailed(id, err))
				continue
			}
			out = append(out, bulkChanged(id))
			kick = true
		}
	}
	if kick {
		s.jobs.Kick(jobs.Search) // search at once under the new Profile
	}
	return out, nil
}

// bulkAddVersion adds a Version in the Slot under the Profile to each Title
// whose Slot is empty.
func (s *server) bulkAddVersion(ctx context.Context, ids []int64, b oapi.TitlesBulkAddVersion) ([]oapi.TitleBulkOutcome, error) {
	sl, err := s.bulkSlot(ctx, b.Slot, &b.Profile)
	if err != nil {
		return nil, err
	}
	out := make([]oapi.TitleBulkOutcome, 0, len(ids))
	kick := false
	for _, id := range ids {
		_, err := s.library.AddVersion(ctx, id, library.VersionSpec{Slot: sl, Profile: b.Profile})
		switch {
		case errors.Is(err, library.ErrNotFound):
			out = append(out, bulkNotFound(id))
		case errors.Is(err, library.ErrSlotTaken):
			out = append(out, bulkSkipped(id, "slot_taken", "Already has a "+sl.Name()+" Version"))
		case err != nil:
			out = append(out, s.bulkFailed(id, err))
		default:
			out = append(out, bulkChanged(id))
			kick = true
		}
	}
	if kick {
		s.jobs.Kick(jobs.Search) // the new Versions are due now
	}
	return out, nil
}

// bulkSearch makes the Titles' Wanted Versions due now and wakes the sweep,
// which keeps to the indexers' budgets.
func (s *server) bulkSearch(ctx context.Context, ids []int64) ([]oapi.TitleBulkOutcome, error) {
	rows, err := s.bulkRows(ctx)
	if err != nil {
		return nil, err
	}
	due, err := s.library.SearchWanted(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]oapi.TitleBulkOutcome, 0, len(ids))
	for _, id := range ids {
		switch _, ok := rows[id]; {
		case !ok:
			out = append(out, bulkNotFound(id))
		case due[id] == 0:
			out = append(out, bulkSkipped(id, "nothing_wanted", "Nothing Wanted"))
		default:
			out = append(out, bulkChanged(id))
		}
	}
	if len(due) > 0 {
		s.jobs.Kick(jobs.Search)
	}
	return out, nil
}

// bulkEachTitle reads each Title and answers for it with do; a Title that
// does not exist is skipped.
func (s *server) bulkEachTitle(ctx context.Context, ids []int64, do func(library.Detail) oapi.TitleBulkOutcome) ([]oapi.TitleBulkOutcome, error) {
	view, err := s.view(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]oapi.TitleBulkOutcome, 0, len(ids))
	for _, id := range ids {
		d, err := s.library.Get(ctx, id, view)
		switch {
		case errors.Is(err, library.ErrNotFound):
			out = append(out, bulkNotFound(id))
		case err != nil:
			out = append(out, s.bulkFailed(id, err))
		default:
			out = append(out, do(d))
		}
	}
	return out, nil
}

// bulkRefresh starts a metadata refresh of each Title that is not frozen.
func (s *server) bulkRefresh(ctx context.Context, ids []int64) ([]oapi.TitleBulkOutcome, error) {
	return s.bulkEachTitle(ctx, ids, func(d library.Detail) oapi.TitleBulkOutcome {
		if d.MetadataFrozen {
			return bulkSkipped(d.ID, "frozen", "Metadata frozen")
		}
		s.refresher.Enqueue(d.ID)
		return bulkChanged(d.ID)
	})
}

// bulkFreeze freezes or unfreezes each Title's metadata, as PATCH /titles/{id} does.
func (s *server) bulkFreeze(ctx context.Context, ids []int64, frozen bool) ([]oapi.TitleBulkOutcome, error) {
	return s.bulkEachTitle(ctx, ids, func(d library.Detail) oapi.TitleBulkOutcome {
		if d.MetadataFrozen == frozen {
			return bulkUnchanged(d.ID)
		}
		if err := s.library.SetMetadataFrozen(ctx, d.ID, frozen); err != nil {
			return s.bulkFailed(d.ID, err)
		}
		if frozen {
			// "Keep as is" settles the Title gone upstream row.
			if err := s.health.Clear(ctx, health.GoneUpstreamKey(d.ID)); err != nil {
				return s.bulkFailed(d.ID, err)
			}
		}
		return bulkChanged(d.ID)
	})
}

// bulkRemove removes each Title from the Library, as DELETE /titles/{id} does.
func (s *server) bulkRemove(ctx context.Context, ids []int64, deleteFiles bool) ([]oapi.TitleBulkOutcome, error) {
	out := make([]oapi.TitleBulkOutcome, 0, len(ids))
	for _, id := range ids {
		switch err := s.remover.DeleteTitle(ctx, id, deleteFiles); {
		case errors.Is(err, library.ErrNotFound):
			out = append(out, bulkNotFound(id))
		case err != nil:
			out = append(out, s.bulkFailed(id, err))
		default:
			out = append(out, bulkChanged(id))
		}
	}
	return out, nil
}

// bulkRemoveVersion removes each Title's Version in the Slot.
func (s *server) bulkRemoveVersion(ctx context.Context, ids []int64, b oapi.TitlesBulkRemoveVersion) ([]oapi.TitleBulkOutcome, error) {
	sl, err := s.bulkSlot(ctx, b.Slot, nil)
	if err != nil {
		return nil, err
	}
	rows, err := s.bulkRows(ctx)
	if err != nil {
		return nil, err
	}
	deleteFiles := b.DeleteFiles != nil && *b.DeleteFiles
	out := make([]oapi.TitleBulkOutcome, 0, len(ids))
	for _, id := range ids {
		row, ok := rows[id]
		v := row.Slots[sl]
		switch {
		case !ok:
			out = append(out, bulkNotFound(id))
		case v == nil:
			out = append(out, bulkNoVersion(id, sl))
		default:
			if err := s.remover.DeleteVersion(ctx, v.VersionID, deleteFiles); err != nil {
				out = append(out, s.bulkFailed(id, err))
				continue
			}
			out = append(out, bulkChanged(id))
		}
	}
	return out, nil
}
