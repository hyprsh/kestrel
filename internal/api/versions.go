package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/release"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
)

// checkProfile is the 422 for a Profile that cannot be used, or nil.
func (s *server) checkProfile(ctx context.Context, key string, kind release.Kind) error {
	all, err := s.profiles.List(ctx)
	if err != nil {
		return err
	}
	return profileProblem("profile", all, key, kind)
}

// kindOf is the scoring kind of a Title's kind, as the library or the API names it.
func kindOf[K library.Kind | oapi.TitleKind](k K) release.Kind {
	if string(k) == string(release.KindSeries) {
		return release.KindSeries
	}
	return release.KindMovie
}

// kindsToAPI is the kinds as the API names them; never nil, so it encodes as a list.
func kindsToAPI(ks []release.Kind) []oapi.TitleKind {
	out := make([]oapi.TitleKind, len(ks))
	for i, k := range ks {
		out[i] = oapi.Movie
		if k == release.KindSeries {
			out[i] = oapi.Series
		}
	}
	return out
}

func kindName(k release.Kind) string {
	if k == release.KindSeries {
		return "a Series"
	}
	return "a Movie"
}

// titleKind is the kind of a Title, or library.ErrNotFound.
func (s *server) titleKind(ctx context.Context, id int64) (release.Kind, error) {
	view, err := s.view(ctx)
	if err != nil {
		return "", err
	}
	d, err := s.library.Get(ctx, id, view)
	if err != nil {
		return "", err
	}
	return kindOf(d.Kind), nil
}

// errProfileTaken is the 422 for a Profile another Version of the Title already uses.
func errProfileTaken(field string) error {
	return invalid(field, "profile_taken", "Another Version of the Title already uses that Profile: a Title's Versions use different Profiles")
}

// profileProblem is nil when the key names an enabled Profile (any Profile can fill any Slot), else the 422 saying why not.
func profileProblem(field string, all []profiles.Profile, key string, kind release.Kind) error {
	_, err := profiles.PickFor(all, key, kind)
	if errors.Is(err, profiles.ErrWrongKind) {
		return invalid(field, "profile_kind", "That Profile does not apply to "+kindName(kind)+": its TRaSH profile covers the other kind only")
	}
	return pickProblem(field, err)
}

// pickProblem is the 422 for a Profile that profiles.Pick refused, or nil.
func pickProblem(field string, err error) error {
	switch {
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
	formats, err := s.movieFormats(ctx, d)
	if err != nil {
		return oapi.VersionDetail{}, err
	}
	for _, v := range detailToAPI(d, view.Country, formats).Versions {
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
	sl, err := s.slotFromAPI(ctx, r.Body.Slot, "slot")
	if err != nil {
		return nil, err
	}
	kind, err := s.titleKind(ctx, r.Id)
	if errors.Is(err, library.ErrNotFound) {
		return nil, problem(http.StatusNotFound, "not_found", "no such Title")
	}
	if err != nil {
		return nil, err
	}
	if err := s.checkProfile(ctx, r.Body.Profile, kind); err != nil {
		return nil, err
	}
	id, err := s.library.AddVersion(ctx, r.Id, library.VersionSpec{Slot: sl, Profile: r.Body.Profile})
	switch {
	case errors.Is(err, library.ErrProfileTaken):
		return nil, errProfileTaken("profile")
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
	kind, err := s.titleKind(ctx, ref.TitleID)
	if err != nil {
		return nil, err
	}
	if err := s.checkProfile(ctx, r.Body.Profile, kind); err != nil {
		return nil, err
	}
	if err := s.imports.SwitchProfile(ctx, ref.TitleID, ref.ID, r.Body.Profile); errors.Is(err, library.ErrProfileTaken) {
		return nil, errProfileTaken("profile")
	} else if err != nil {
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
