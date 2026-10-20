package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/library"
)

// DeleteVersionFiles is DELETE /versions/{id}/files: it deletes files and
// keeps the Version, blocklisting their Releases when asked.
func (s *server) DeleteVersionFiles(ctx context.Context, r oapi.DeleteVersionFilesRequestObject) (oapi.DeleteVersionFilesResponseObject, error) {
	scope := library.Scope{Season: r.Params.Season}
	if r.Params.EpisodeIds != nil {
		scope.EpisodeIDs = *r.Params.EpisodeIds
	}
	d, err := s.files.DeleteFiles(ctx, r.Id, scope, r.Params.Blocklist != nil && *r.Params.Blocklist)
	var se *library.ScopeError
	switch {
	case errors.Is(err, library.ErrVersionNotFound), errors.Is(err, library.ErrNotFound):
		return nil, problem(http.StatusNotFound, "not_found", "no such Version")
	case errors.As(err, &se):
		return nil, invalid(se.Field, se.Code, se.Message)
	case err != nil:
		return nil, err
	}
	out := oapi.DeletedFiles{Files: make([]oapi.DeletedFile, 0, len(d.Files)), NotDeleted: make([]oapi.NotDeletedFile, 0, len(d.NotDeleted))}
	for _, f := range d.NotDeleted {
		out.NotDeleted = append(out.NotDeleted, oapi.NotDeletedFile{Path: f.Path, EpisodeIds: append([]int64{}, f.EpisodeIDs...), Reason: f.Reason})
	}
	for _, f := range d.Files {
		out.Files = append(out.Files, oapi.DeletedFile{
			Path: f.Path, Size: f.Size, ReleaseName: f.ReleaseName, EpisodeIds: append([]int64{}, f.EpisodeIDs...), Blocklisted: f.Blocklisted,
		})
	}
	return oapi.DeleteVersionFiles200JSONResponse(out), nil
}
