package api

import (
	"context"
	"errors"
	"net/http"
	"slices"

	"github.com/hyprsh/kestrel/internal/imports"
	"github.com/hyprsh/kestrel/internal/settings/rootfolders"
)

// moveTitle moves a Title to another of its kind's Root folders (PATCH /titles/{id} root_folder).
func (s *server) moveTitle(ctx context.Context, id int64, root string) error {
	view, err := s.view(ctx)
	if err != nil {
		return err
	}
	d, err := s.library.Get(ctx, id, view)
	if err != nil {
		return seriesProblem(err)
	}
	kind := rootfolders.Kind(d.Kind)
	roots, _, err := s.rootFolders.Get(ctx)
	if err != nil {
		return err
	}
	if root == "" || !slices.Contains(rootsOf(roots, kind), root) {
		return invalid("root_folder", "not_found", kind.NotConfiguredMessage())
	}
	_, err = s.files.Move(ctx, id, root)
	switch {
	case errors.Is(err, imports.ErrFolderTaken):
		return problem(http.StatusConflict, "folder_taken", "A folder named like this Title's is already in that Root folder")
	case errors.Is(err, imports.ErrImportRunning):
		return problem(http.StatusConflict, "import_running", "An Import into this Title is running; try again when it is done")
	case errors.Is(err, imports.ErrOtherFilesystem):
		return invalid("root_folder", "other_filesystem", "That Root folder is on another filesystem. Kestrel moves a Title only between Root folders on the same mount")
	case err != nil:
		return seriesProblem(err)
	}
	return nil
}

// rootsOf is the kind's configured Root folders.
func rootsOf(f rootfolders.Folders, kind rootfolders.Kind) []string {
	if kind == rootfolders.Series {
		return f.Series
	}
	return f.Movies
}
