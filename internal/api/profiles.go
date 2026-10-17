package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/resolution"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
)

func profilesProblem(err error) error {
	var ve *profiles.ValidationError
	switch {
	case errors.Is(err, profiles.ErrNotFound):
		return problem(http.StatusNotFound, "not_found", "no such Profile")
	case errors.As(err, &ve):
		return invalid(ve.Field, ve.Code, ve.Message)
	}
	return err
}

func profileToAPI(p profiles.Profile) oapi.Profile {
	slot := oapi.Sd
	switch p.Slot {
	case resolution.HD:
		slot = oapi.Hd
	case resolution.UHD:
		slot = oapi.Uhd
	}
	rule := oapi.ProfileLanguageRule("primary")
	if p.Rule == scoring.OriginalLanguage {
		rule = "original"
	}
	return oapi.Profile{
		Key: p.Key, Name: p.Name, Slot: slot, LanguageRule: rule,
		OriginalFallback: p.OriginalFallback, Enabled: p.Enabled,
		DefaultMovies: p.DefaultMovies, DefaultSeries: p.DefaultSeries,
		MinHeight: p.MinHeight, MaxHeight: p.MaxHeight,
		TrashProfileMovies: p.TrashMovies, TrashProfileSeries: p.TrashSeries,
	}
}

func (s *server) ListProfiles(ctx context.Context, _ oapi.ListProfilesRequestObject) (oapi.ListProfilesResponseObject, error) {
	all, err := s.profiles.List(ctx)
	if err != nil {
		return nil, err
	}
	out := oapi.ProfileList{Items: make([]oapi.Profile, len(all))}
	for i, p := range all {
		out.Items[i] = profileToAPI(p)
	}
	return oapi.ListProfiles200JSONResponse(out), nil
}

func (s *server) PatchProfile(ctx context.Context, r oapi.PatchProfileRequestObject) (oapi.PatchProfileResponseObject, error) {
	if r.Body == nil {
		return nil, invalid("body", "required", "a body is required")
	}
	b := r.Body
	p, err := s.profiles.Patch(ctx, string(r.Key), profiles.Patch{
		Enabled: b.Enabled, OriginalFallback: b.OriginalFallback, DefaultMovies: b.DefaultMovies, DefaultSeries: b.DefaultSeries,
	})
	if err != nil {
		return nil, profilesProblem(err)
	}
	return oapi.PatchProfile200JSONResponse(profileToAPI(p)), nil
}

func (s *server) settingsBody(ctx context.Context) (oapi.Settings, error) {
	region, _, err := s.profiles.Region(ctx)
	if err != nil {
		return oapi.Settings{}, err
	}
	kids, _, err := s.profiles.Kids(ctx)
	if err != nil {
		return oapi.Settings{}, err
	}
	var out oapi.Settings
	out.LanguageRegion.PrimaryLanguage = oapi.PrimaryLanguage(region.Primary)
	out.LanguageRegion.ReleaseDateCountry = region.Country
	out.KidsRule.Enabled = kids.Enabled
	out.KidsRule.Threshold = oapi.SettingsKidsRuleThreshold(kids.Threshold)
	return out, nil
}

func (s *server) GetSettings(ctx context.Context, _ oapi.GetSettingsRequestObject) (oapi.GetSettingsResponseObject, error) {
	out, err := s.settingsBody(ctx)
	if err != nil {
		return nil, err
	}
	return oapi.GetSettings200JSONResponse(out), nil
}

func (s *server) PatchSettings(ctx context.Context, r oapi.PatchSettingsRequestObject) (oapi.PatchSettingsResponseObject, error) {
	if r.Body == nil {
		return nil, invalid("body", "required", "a body is required")
	}
	// Validate every section before saving any, so a rejected patch changes nothing.
	if k := r.Body.KidsRule; k != nil && k.Threshold != nil {
		switch *k.Threshold {
		case 0, 6, 12:
		default:
			return nil, invalid("threshold", "invalid", "The threshold age is 0, 6 or 12")
		}
	}
	if l := r.Body.LanguageRegion; l != nil {
		var patch profiles.RegionPatch
		if l.PrimaryLanguage != nil {
			lang := profiles.Language(*l.PrimaryLanguage)
			patch.Primary = &lang
		}
		patch.Country = l.ReleaseDateCountry
		if _, err := s.profiles.SetRegion(ctx, patch); err != nil {
			return nil, profilesProblem(err)
		}
	}
	if k := r.Body.KidsRule; k != nil {
		if _, err := s.profiles.SetKids(ctx, profiles.KidsPatch{Enabled: k.Enabled, Threshold: k.Threshold}); err != nil {
			return nil, profilesProblem(err)
		}
	}
	out, err := s.settingsBody(ctx)
	if err != nil {
		return nil, err
	}
	return oapi.PatchSettings200JSONResponse(out), nil
}
