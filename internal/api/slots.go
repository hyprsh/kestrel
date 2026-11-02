package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/configfile"
	"github.com/hyprsh/kestrel/internal/slot"
	"github.com/hyprsh/kestrel/internal/slot/slots"
)

// slotsProblem answers a broken Slot rule: 422 for a value that cannot be a
// Slot, 409 for a rule about what the library holds, 404 for an unknown id.
func slotsProblem(err error) error {
	var re *slot.RuleError
	switch {
	case errors.Is(err, slots.ErrNotFound):
		return problem(http.StatusNotFound, "not_found", "no such Slot")
	case errors.As(err, &re) && re.Conflict:
		return problem(http.StatusConflict, "conflict", re.Message)
	case errors.As(err, &re):
		field := re.Field
		if field == "" {
			field = "slots"
		}
		return invalid(field, "invalid", re.Message)
	}
	return err
}

func (s *server) slotToAPI(r slot.Record) oapi.Slot {
	out := oapi.Slot{
		Id: r.ID.Key(), Label: r.Label, OnForNewTitles: r.OnForNew, Position: r.Position, FromConfigFile: s.declares(configfile.SectionSlots),
	}
	if r.DefaultMovies != "" {
		out.DefaultMovies = &r.DefaultMovies
	}
	if r.DefaultSeries != "" {
		out.DefaultSeries = &r.DefaultSeries
	}
	return out
}

func (s *server) ListSlots(ctx context.Context, _ oapi.ListSlotsRequestObject) (oapi.ListSlotsResponseObject, error) {
	all, err := s.slots.List(ctx)
	if err != nil {
		return nil, err
	}
	out := oapi.SlotList{Items: make([]oapi.Slot, len(all))}
	for i, r := range all {
		out.Items[i] = s.slotToAPI(r)
	}
	return oapi.ListSlots200JSONResponse(out), nil
}

func (s *server) CreateSlot(ctx context.Context, r oapi.CreateSlotRequestObject) (oapi.CreateSlotResponseObject, error) {
	if r.Body == nil {
		return nil, invalid("body", "required", "a body is required")
	}
	if err := s.refuseDeclared(configfile.SectionSlots); err != nil {
		return nil, err
	}
	b := r.Body
	got, err := s.slots.Create(ctx, slots.Create{
		Label: b.Label, DefaultMovies: deref(b.DefaultMovies), DefaultSeries: deref(b.DefaultSeries), OnForNew: b.OnForNewTitles != nil && *b.OnForNewTitles,
	})
	if err != nil {
		return nil, slotsProblem(err)
	}
	return oapi.CreateSlot201JSONResponse(s.slotToAPI(got)), nil
}

func (s *server) PatchSlot(ctx context.Context, r oapi.PatchSlotRequestObject) (oapi.PatchSlotResponseObject, error) {
	if r.Body == nil {
		return nil, invalid("body", "required", "a body is required")
	}
	if err := s.refuseDeclared(configfile.SectionSlots); err != nil {
		return nil, err
	}
	b := r.Body
	id := slot.Slot(r.Id)
	patch := slots.Patch{
		Label: b.Label, DefaultMovies: b.DefaultMovies, DefaultSeries: b.DefaultSeries, OnForNew: b.OnForNewTitles, Position: b.Position,
	}
	// A new label renames the Slot's files, and the answer says how many.
	var renames *int
	if b.Label != nil {
		all, err := s.slots.List(ctx)
		if err != nil {
			return nil, err
		}
		for _, cur := range all {
			if cur.ID == id && cur.Label != *b.Label {
				n, err := s.slots.Files(ctx, id)
				if err != nil {
					return nil, err
				}
				renames = &n
			}
		}
	}
	update := s.slots.Update
	if r.Params.DryRun != nil && *r.Params.DryRun {
		update = s.slots.Check
	}
	got, err := update(ctx, id, patch)
	if err != nil {
		return nil, slotsProblem(err)
	}
	out := s.slotToAPI(got)
	out.RenamesFiles = renames
	return oapi.PatchSlot200JSONResponse(out), nil
}

func (s *server) DeleteSlot(ctx context.Context, r oapi.DeleteSlotRequestObject) (oapi.DeleteSlotResponseObject, error) {
	if err := s.refuseDeclared(configfile.SectionSlots); err != nil {
		return nil, err
	}
	if err := s.slots.Delete(ctx, slot.Slot(r.Id)); err != nil {
		return nil, slotsProblem(err)
	}
	return oapi.DeleteSlot204Response{}, nil
}

// slotFromAPI reads a Slot id from a request: it must name an existing Slot,
// or the field is a validation problem.
func (s *server) slotFromAPI(ctx context.Context, id oapi.SlotId, field string) (slot.Slot, error) {
	sl, ok := slot.Parse(id)
	if ok {
		var err error
		if ok, err = s.slots.Known(ctx, sl); err != nil {
			return sl, err
		}
	}
	if !ok {
		return sl, invalid(field, "invalid", fmt.Sprintf("%q is not the id of a Slot (GET /slots lists them)", id))
	}
	return sl, nil
}

// slotIDs is the ids of Slot records, in their order.
func slotIDs(rs []slot.Record) []slot.Slot {
	out := make([]slot.Slot, len(rs))
	for i, r := range rs {
		out[i] = r.ID
	}
	return out
}
