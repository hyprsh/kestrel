package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/configfile"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
	"github.com/hyprsh/kestrel/internal/slot"
	"github.com/hyprsh/kestrel/internal/slot/presets"
)

func (s *server) ListSlotPresets(ctx context.Context, _ oapi.ListSlotPresetsRequestObject) (oapi.ListSlotPresetsResponseObject, error) {
	out := oapi.SlotPresetList{Items: []oapi.SlotPreset{}}
	if !s.declares(configfile.SectionSlots) && !s.declares(configfile.SectionProfiles) {
		all, err := s.presets.List(ctx)
		if err != nil {
			return nil, err
		}
		for _, p := range all {
			item := oapi.SlotPreset{Id: oapi.SlotPresetId(p.ID), Name: p.Name, Slots: make([]oapi.SlotPresetSlot, len(p.Slots))}
			for i, sp := range p.Slots {
				item.Slots[i] = oapi.SlotPresetSlot{Label: sp.Label, OnForNewTitles: sp.OnForNew}
				if sp.Movies != nil {
					name := sp.Movies.Name()
					item.Slots[i].DefaultMovies = &name
				}
				if sp.Series != nil {
					name := sp.Series.Name()
					item.Slots[i].DefaultSeries = &name
				}
			}
			out.Items = append(out.Items, item)
		}
		out.Available = len(out.Items) > 0
	}
	return oapi.ListSlotPresets200JSONResponse(out), nil
}

func (s *server) ApplySlotPreset(ctx context.Context, r oapi.ApplySlotPresetRequestObject) (oapi.ApplySlotPresetResponseObject, error) {
	if err := s.refuseDeclared(configfile.SectionSlots, configfile.SectionProfiles); err != nil {
		return nil, err
	}
	got, err := s.presets.Apply(ctx, presets.ID(r.Id))
	if err != nil {
		return nil, presetProblem(err)
	}
	out := oapi.SlotList{Items: make([]oapi.Slot, len(got))}
	for i, r := range got {
		out.Items[i] = s.slotToAPI(r)
	}
	return oapi.ApplySlotPreset200JSONResponse(out), nil
}

// presetProblem answers what applying a preset refused: the preset, the library, a Slot rule or a Profile.
func presetProblem(err error) error {
	var re *slot.RuleError
	var ve *profiles.ValidationError
	switch {
	case errors.Is(err, presets.ErrNotFound):
		return problem(http.StatusNotFound, "not_found", "no such Slot preset")
	case errors.Is(err, presets.ErrHasVersions):
		return problem(http.StatusConflict, "conflict", "The library holds a Version, so a preset cannot replace the Slots: change them one by one")
	case errors.As(err, &re):
		return slotsProblem(err)
	case errors.As(err, &ve):
		return profilesProblem(err)
	}
	return err
}
