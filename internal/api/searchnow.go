package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/library"
)

// SearchVersion is POST /versions/{id}/search, Search now: it checks the
// scope and starts the search in the background, answering 202 at once. With
// upgrade it searches the filled episodes (or Movie) for a better Release; it
// answers 200 instead when nothing in scope can be upgraded.
func (s *server) SearchVersion(ctx context.Context, r oapi.SearchVersionRequestObject) (oapi.SearchVersionResponseObject, error) {
	var scope library.Scope
	upgrade := false
	if r.Body != nil {
		upgrade = r.Body.Upgrade != nil && *r.Body.Upgrade
		scope.Season = r.Body.Season
		if r.Body.EpisodeIds != nil {
			scope.EpisodeIDs = *r.Body.EpisodeIds
		}
	}
	started := true
	var err error
	if upgrade {
		started, err = s.acquire.StartUpgradeSearch(ctx, r.Id, scope)
	} else {
		err = s.acquire.StartSearch(ctx, r.Id, scope)
	}
	var se *library.ScopeError
	switch {
	case errors.Is(err, library.ErrNotFound):
		return nil, problem(http.StatusNotFound, "not_found", "no such Version")
	case errors.As(err, &se):
		return nil, invalid(se.Field, se.Code, se.Message)
	case err != nil:
		return nil, err
	}
	if !started {
		return oapi.SearchVersion200Response{}, nil
	}
	return oapi.SearchVersion202Response{}, nil
}
