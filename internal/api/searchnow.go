package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/library"
)

// searchFinished is the `search_finished` frame of the search the id was answered for.
func searchFinished(id string, f acquire.Finished) oapi.SearchFinished {
	out := oapi.SearchFinished{SearchId: id, VersionId: f.VersionID, TitleId: f.TitleID, Title: f.Title, Upgrade: f.Upgrade, Outcome: oapi.SearchFinishedOutcomeNone, Grabbed: f.Grabbed}
	switch f.End {
	case acquire.SearchGrabbed:
		out.Outcome = oapi.SearchFinishedOutcomeGrabbed
	case acquire.SearchNoIndexer:
		out.Outcome, out.Error = oapi.SearchFinishedOutcomeFailed, ptr("No indexer is enabled")
	case acquire.SearchError:
		out.Outcome = oapi.SearchFinishedOutcomeFailed
		msg := "The indexers did not answer"
		if f.Err != nil {
			msg = f.Err.Error()
		}
		out.Error = &msg
	}
	return out
}

func newSearchID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

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
	id := newSearchID()
	finished := func(f acquire.Finished) { s.hub.send(frame{event: "search_finished", data: searchFinished(id, f)}) }
	if upgrade {
		started, err = s.acquire.StartUpgradeSearch(ctx, r.Id, scope, finished)
	} else {
		err = s.acquire.StartSearch(ctx, r.Id, scope, finished)
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
	return oapi.SearchVersion202JSONResponse{SearchId: id}, nil
}
