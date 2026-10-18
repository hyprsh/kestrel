package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/imports"
)

func cleanupProblem(err error) error {
	switch {
	case errors.Is(err, imports.ErrNoPreview):
		return problem(http.StatusNotFound, "not_found", "That Clean up preview is gone; preview again")
	case errors.Is(err, imports.ErrNoTitle):
		return problem(http.StatusNotFound, "not_found", "no such Title folder")
	}
	return err
}

func (s *server) PreviewCleanup(ctx context.Context, r oapi.PreviewCleanupRequestObject) (oapi.PreviewCleanupResponseObject, error) {
	var titleIDs []int64
	if r.Body != nil && r.Body.TitleIds != nil {
		titleIDs = *r.Body.TitleIds
	}
	p, err := s.cleanup.Preview(ctx, titleIDs)
	if err != nil {
		return nil, cleanupProblem(err)
	}
	out := oapi.CleanupPreview{PreviewId: p.ID, Categories: make([]oapi.CleanupPreviewCategory, 0, len(p.Categories))}
	for _, g := range p.Categories {
		c := oapi.CleanupPreviewCategory{Key: oapi.CleanupCategoryKey(g.Key), DefaultTicked: g.DefaultTicked, Count: len(g.Files), Size: g.Size}
		c.Files = make([]oapi.CleanupPreviewFile, len(g.Files))
		for i, f := range g.Files {
			c.Files[i] = oapi.CleanupPreviewFile{Path: f.Path, Size: f.Size, TitleId: f.TitleID}
		}
		out.Categories = append(out.Categories, c)
	}
	return oapi.PreviewCleanup200JSONResponse(out), nil
}

func (s *server) RunCleanup(ctx context.Context, r oapi.RunCleanupRequestObject) (oapi.RunCleanupResponseObject, error) {
	if r.Body == nil {
		return nil, invalid("body", "required", "a body is required")
	}
	cats := make([]imports.CleanupCategory, len(r.Body.Categories))
	for i, c := range r.Body.Categories {
		cats[i] = imports.CleanupCategory(c)
	}
	var exclude []string
	if r.Body.Exclude != nil {
		exclude = *r.Body.Exclude
	}
	res, err := s.cleanup.Run(ctx, r.Body.PreviewId, cats, exclude)
	if err != nil {
		return nil, cleanupProblem(err)
	}
	return oapi.RunCleanup202JSONResponse(oapi.CleanupResult{Deleted: res.Deleted, Bytes: res.Bytes, Failed: res.Failed}), nil
}
