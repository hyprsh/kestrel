package api

import (
	"context"
	"errors"
	"net/http"
	"path/filepath"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/resolution"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
)

// checkProfile is the 422 for a Profile that cannot fill the Slot, or nil.
func (s *server) checkProfile(ctx context.Context, key string, slot resolution.Class) error {
	all, err := s.profiles.List(ctx)
	if err != nil {
		return err
	}
	return profileProblem("profile", all, key, slot)
}

// profileProblem is nil when the key names an enabled Profile of the Slot, else the 422 saying why not.
func profileProblem(field string, all []profiles.Profile, key string, slot resolution.Class) error {
	switch _, err := profiles.Pick(all, key, slot); {
	case errors.Is(err, profiles.ErrWrongSlot):
		return invalid(field, "wrong_slot", "That Profile belongs to another Slot")
	case errors.Is(err, profiles.ErrDisabled):
		return invalid(field, "disabled", "That Profile is disabled")
	case err != nil:
		return invalid(field, "not_found", "No such Profile")
	}
	return nil
}

// versionDetail reads one Version of a Title back in API shape.
func (s *server) versionDetail(ctx context.Context, titleID, versionID int64) (oapi.VersionDetail, error) {
	view, err := s.view(ctx)
	if err != nil {
		return oapi.VersionDetail{}, err
	}
	d, err := s.library.Get(ctx, titleID, view)
	if err != nil {
		return oapi.VersionDetail{}, err
	}
	for _, v := range detailToAPI(d, view.Country).Versions {
		if v.Id == versionID {
			return v, nil
		}
	}
	return oapi.VersionDetail{}, library.ErrVersionNotFound
}

func (s *server) AddVersion(ctx context.Context, r oapi.AddVersionRequestObject) (oapi.AddVersionResponseObject, error) {
	if r.Body == nil {
		return nil, invalid("body", "required", "a body is required")
	}
	slot := slotFromAPI(r.Body.Slot)
	if err := s.checkProfile(ctx, r.Body.Profile, slot); err != nil {
		return nil, err
	}
	id, err := s.library.AddVersion(ctx, r.Id, library.VersionSpec{Slot: slot, Profile: r.Body.Profile})
	switch {
	case errors.Is(err, library.ErrNotFound):
		return nil, problem(http.StatusNotFound, "not_found", "no such Title")
	case errors.Is(err, library.ErrSlotTaken):
		return nil, problem(http.StatusConflict, "conflict", "That Slot already holds a Version")
	case err != nil:
		return nil, err
	}
	s.jobs.Kick(jobs.Search) // search at once: the new Version is due now
	v, err := s.versionDetail(ctx, r.Id, id)
	if err != nil {
		return nil, err
	}
	return oapi.AddVersion201JSONResponse(v), nil
}

func (s *server) PatchVersion(ctx context.Context, r oapi.PatchVersionRequestObject) (oapi.PatchVersionResponseObject, error) {
	if r.Body == nil {
		return nil, invalid("body", "required", "a body is required")
	}
	ref, err := s.library.GetVersion(ctx, r.Id)
	if errors.Is(err, library.ErrVersionNotFound) {
		return nil, problem(http.StatusNotFound, "not_found", "no such Version")
	}
	if err != nil {
		return nil, err
	}
	if err := s.checkProfile(ctx, r.Body.Profile, ref.Slot); err != nil {
		return nil, err
	}
	if err := s.library.SetProfile(ctx, ref.ID, r.Body.Profile); err != nil {
		return nil, err
	}
	if err := s.imports.Rescore(ctx, ref.TitleID, ref.ID); err != nil {
		return nil, err
	}
	s.jobs.Kick(jobs.Search) // search at once under the new Profile
	v, err := s.versionDetail(ctx, ref.TitleID, ref.ID)
	if err != nil {
		return nil, err
	}
	return oapi.PatchVersion200JSONResponse(v), nil
}

func (s *server) DeleteVersion(ctx context.Context, r oapi.DeleteVersionRequestObject) (oapi.DeleteVersionResponseObject, error) {
	err := s.remover.DeleteVersion(ctx, r.Id, r.Params.DeleteFiles != nil && *r.Params.DeleteFiles)
	if errors.Is(err, library.ErrVersionNotFound) {
		return nil, problem(http.StatusNotFound, "not_found", "no such Version")
	} else if err != nil {
		return nil, err
	}
	return oapi.DeleteVersion204Response{}, nil
}

func (s *server) DeleteTitle(ctx context.Context, r oapi.DeleteTitleRequestObject) (oapi.DeleteTitleResponseObject, error) {
	err := s.remover.DeleteTitle(ctx, r.Id, r.Params.DeleteFiles != nil && *r.Params.DeleteFiles)
	if errors.Is(err, library.ErrNotFound) {
		return nil, problem(http.StatusNotFound, "not_found", "no such Title")
	} else if err != nil {
		return nil, err
	}
	return oapi.DeleteTitle204Response{}, nil
}

func (s *server) RefreshTitle(ctx context.Context, r oapi.RefreshTitleRequestObject) (oapi.RefreshTitleResponseObject, error) {
	view, err := s.view(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := s.library.Get(ctx, r.Id, view); errors.Is(err, library.ErrNotFound) {
		return nil, problem(http.StatusNotFound, "not_found", "no such Title")
	} else if err != nil {
		return nil, err
	}
	s.refresher.Enqueue(r.Id)
	return oapi.RefreshTitle202Response{}, nil
}

// titleFolder is the Title's folder on disk, or "" while it has none yet.
func (s *server) titleFolder(ctx context.Context, titleID int64) string {
	view, err := s.view(ctx)
	if err != nil {
		return ""
	}
	d, err := s.library.Get(ctx, titleID, view)
	if err != nil || d.Folder == "" {
		return ""
	}
	return filepath.Join(d.RootFolder, d.Folder)
}
