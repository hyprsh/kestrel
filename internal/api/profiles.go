package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/scoring"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
	"github.com/hyprsh/kestrel/internal/settings/rootfolders"
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
	slot := slotToAPI(p.Slot)
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
	roots, _, err := s.rootFolders.Get(ctx)
	if err != nil {
		return oapi.Settings{}, err
	}
	var out oapi.Settings
	out.CheckGithubUpdates = s.updates.Enabled(ctx)
	out.RootFolders = oapi.RootFolders{Movies: roots.Movies, Series: roots.Series}
	out.LanguageRegion.PrimaryLanguage = oapi.PrimaryLanguage(region.Primary)
	out.LanguageRegion.ReleaseDateCountry = region.Country
	out.Trash.AutoUpdate, err = s.trash.AutoUpdate(ctx)
	if err != nil {
		return oapi.Settings{}, err
	}
	set, err := s.keys.OverridesSet(ctx)
	if err != nil {
		return oapi.Settings{}, err
	}
	out.Metadata.TmdbApiKeySet, out.Metadata.TvdbApiKeySet = set.TMDB, set.TVDB
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
	if l := r.Body.LanguageRegion; l != nil && l.PrimaryLanguage != nil {
		// A new Primary Language re-scores every file in the same step, with no
		// Grab deciding on a mix of old and new Scores.
		var resp oapi.PatchSettingsResponseObject
		err := s.trash.ChangeLanguage(ctx, func() (err error) {
			resp, err = s.patchSettings(ctx, r)
			return err
		})
		if err != nil {
			return nil, err
		}
		return resp, nil
	}
	return s.patchSettings(ctx, r)
}

func (s *server) patchSettings(ctx context.Context, r oapi.PatchSettingsRequestObject) (oapi.PatchSettingsResponseObject, error) {
	// Every section saves in one transaction, so a rejected patch changes nothing.
	tx, err := s.opts.Store.Write().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	w := s.settings.InTx(tx)
	if rf := r.Body.RootFolders; rf != nil {
		if _, err := w.SetRootFolders(ctx, rootfolders.Patch{Movies: rf.Movies, Series: rf.Series}); err != nil {
			var ve *rootfolders.ValidationError
			if errors.As(err, &ve) {
				return nil, invalid(ve.Field, ve.Code, ve.Message)
			}
			return nil, err
		}
	}
	if l := r.Body.LanguageRegion; l != nil {
		var patch profiles.RegionPatch
		if l.PrimaryLanguage != nil {
			lang := profiles.Language(*l.PrimaryLanguage)
			patch.Primary = &lang
		}
		patch.Country = l.ReleaseDateCountry
		if _, err := w.SetRegion(ctx, patch); err != nil {
			return nil, profilesProblem(err)
		}
	}
	if t := r.Body.Trash; t != nil && t.AutoUpdate != nil {
		if err := w.SetTrashAutoUpdate(ctx, *t.AutoUpdate); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	if m := r.Body.Metadata; m != nil {
		if err := s.keys.SetOverrides(ctx, m.TmdbApiKey, m.TvdbApiKey); err != nil {
			return nil, err
		}
	}
	if on := r.Body.CheckGithubUpdates; on != nil {
		if err := s.updates.SetEnabled(ctx, *on); err != nil {
			return nil, err
		}
		if !*on { // nothing from GitHub stays on screen once the switch is off
			if err := s.updates.Check(ctx); err != nil {
				return nil, err
			}
		}
	}
	out, err := s.settingsBody(ctx)
	if err != nil {
		return nil, err
	}
	return oapi.PatchSettings200JSONResponse(out), nil
}
