package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/library"
)

// DeleteVersionFiles is DELETE /versions/{id}/files: it deletes files and
// keeps the Version, blocklisting their Releases when asked.
func (s *server) DeleteVersionFiles(ctx context.Context, r oapi.DeleteVersionFilesRequestObject) (oapi.DeleteVersionFilesResponseObject, error) {
	scope := library.Scope{Season: r.Params.Season}
	if r.Params.EpisodeIds != nil {
		scope.EpisodeIDs = *r.Params.EpisodeIds
	}
	d, err := s.imports.DeleteFiles(ctx, r.Id, scope)
	var se *library.ScopeError
	switch {
	case errors.Is(err, library.ErrVersionNotFound), errors.Is(err, library.ErrNotFound):
		return nil, problem(http.StatusNotFound, "not_found", "no such Version")
	case errors.As(err, &se):
		return nil, invalid(se.Field, se.Code, se.Message)
	case err != nil:
		return nil, err
	}
	out := oapi.DeletedFiles{Files: make([]oapi.DeletedFile, 0, len(d.Files))}
	paths, episodes := make([]string, 0, len(d.Files)), []int64{}
	for _, f := range d.Files {
		paths = append(paths, f.Path)
		episodes = append(episodes, f.EpisodeIDs...)
		out.Files = append(out.Files, oapi.DeletedFile{
			Path: f.Path, Size: f.Size, ReleaseName: f.ReleaseName, EpisodeIds: append([]int64{}, f.EpisodeIDs...),
		})
	}
	if len(d.Files) > 0 {
		data, _ := json.Marshal(map[string]any{"paths": paths, "episode_ids": episodes})
		s.history.Record(ctx, history.Event{Kind: history.FilesDeleted, TitleID: d.TitleID, VersionID: r.Id, Message: d.Message, Data: data})
	}
	if r.Params.Blocklist != nil && *r.Params.Blocklist {
		blocked := map[int64]bool{} // a season pack's files share one Grab
		for i, f := range d.Files {
			if f.GrabID == 0 {
				continue
			}
			if !blocked[f.GrabID] {
				err := s.acquire.BlockGrab(ctx, f.GrabID, "file deleted and blocklisted")
				if errors.Is(err, acquire.ErrGrabNotFound) {
					continue
				}
				if err != nil {
					return nil, err
				}
				blocked[f.GrabID] = true
			}
			out.Files[i].Blocklisted = true
		}
	}
	return oapi.DeleteVersionFiles200JSONResponse(out), nil
}
