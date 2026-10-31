package api

import (
	"context"
	"time"

	"github.com/hyprsh/kestrel/internal/api/oapi"
)

// ListFolderChanges is the feed of settled Title folder changes that the Silo
// plugin polls. A marker the feed cannot answer is `expired`, never an error.
func (s *server) ListFolderChanges(ctx context.Context, r oapi.ListFolderChangesRequestObject) (oapi.ListFolderChangesResponseObject, error) {
	marker, limit := "", 1000
	if r.Params.Marker != nil {
		marker = *r.Params.Marker
	}
	if r.Params.Limit != nil {
		limit = *r.Params.Limit
	}
	got, err := s.folderChanges.Changes(ctx, marker, limit)
	if err != nil {
		return nil, err
	}
	out := oapi.FolderChangeList{Changes: make([]oapi.FolderChange, 0, len(got.Changes)), NextMarker: got.NextMarker, Expired: got.Expired, More: got.More}
	for _, c := range got.Changes {
		at, err := time.Parse(time.RFC3339, c.At)
		if err != nil {
			return nil, err
		}
		out.Changes = append(out.Changes, oapi.FolderChange{Path: c.Path, Kind: oapi.FolderChangeKind(c.Kind), At: at})
	}
	return oapi.ListFolderChanges200JSONResponse(out), nil
}
