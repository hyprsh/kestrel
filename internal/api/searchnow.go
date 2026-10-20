package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/library"
)

// SearchVersion is POST /versions/{id}/search, Search now: it checks the
// scope and starts the search in the background, answering 202 at once.
func (s *server) SearchVersion(ctx context.Context, r oapi.SearchVersionRequestObject) (oapi.SearchVersionResponseObject, error) {
	var scope library.Scope
	if r.Body != nil {
		scope.Season = r.Body.Season
		if r.Body.EpisodeIds != nil {
			scope.EpisodeIDs = *r.Body.EpisodeIds
		}
	}
	err := s.acquire.StartSearch(ctx, r.Id, scope)
	var se *library.ScopeError
	switch {
	case errors.Is(err, library.ErrNotFound):
		return nil, problem(http.StatusNotFound, "not_found", "no such Version")
	case errors.As(err, &se):
		return nil, invalid(se.Field, se.Code, se.Message)
	case err != nil:
		return nil, err
	}
	return oapi.SearchVersion202Response{}, nil
}
