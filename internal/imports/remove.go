package imports

import (
	"context"
	"os"
	"path/filepath"
	"time"

	"github.com/hyprsh/kestrel/internal/health"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
)

// RemoverLibrary is the part of the Library a Remover needs; *library.Service
// satisfies it.
type RemoverLibrary interface {
	Get(ctx context.Context, id int64, v library.View) (library.Detail, error)
	GetVersion(ctx context.Context, id int64) (library.VersionRef, error)
	RemoveVersion(ctx context.Context, versionID int64) ([]library.File, error)
	RemoveTitle(ctx context.Context, titleID int64) (library.Removed, error)
}

// Downloads cancels the active Grabs of Versions, their client jobs with them;
// *acquire.Service satisfies it.
type Downloads interface {
	CancelVersions(ctx context.Context, versionIDs ...int64) error
}

// RemoverDeps are what NewRemover needs.
type RemoverDeps struct {
	Library   RemoverLibrary
	Downloads Downloads
	// Health clears the Title gone upstream row of a removed Title; may be nil.
	Health interface {
		Clear(ctx context.Context, key string) error
	}
	// Posters drops the cached poster of a removed Title; may be nil.
	Posters interface {
		Remove(kind metadata.Kind, tmdbID int)
	}
	// FolderChanged is told the Title folder files were deleted from; may be nil.
	FolderChanged func(ctx context.Context, folder string)
	Clock         func() time.Time
}

// Remover deletes Versions and Titles from the Library: it cancels their
// Grabs, drops their rows and, when asked, deletes their files.
type Remover struct{ d RemoverDeps }

// NewRemover returns a Remover.
func NewRemover(d RemoverDeps) *Remover {
	if d.Clock == nil {
		d.Clock = time.Now
	}
	return &Remover{d: d}
}

// DeleteVersion removes a Version. With deleteFiles its file goes from disk
// too and the media servers hear of the Title folder. It returns
// library.ErrVersionNotFound for a Version that does not exist.
func (r *Remover) DeleteVersion(ctx context.Context, versionID int64, deleteFiles bool) error {
	ref, err := r.d.Library.GetVersion(ctx, versionID)
	if err != nil {
		return err
	}
	folder := ""
	if d, err := r.d.Library.Get(ctx, ref.TitleID, library.View{Now: r.d.Clock()}); err == nil && d.Folder != "" {
		folder = filepath.Join(d.RootFolder, d.Folder)
	}
	if err := r.d.Downloads.CancelVersions(ctx, versionID); err != nil {
		return err
	}
	files, err := r.d.Library.RemoveVersion(ctx, versionID)
	if err != nil {
		return err
	}
	if deleteFiles {
		for _, f := range files {
			removeWithSidecars(f.Path)
		}
		if len(files) > 0 {
			r.changed(ctx, folder)
		}
	}
	return nil
}

// DeleteTitle removes a Title with all its Versions. With deleteFiles their
// files go from disk, the Title folder too if nothing else is in it. It
// returns library.ErrNotFound for a Title that does not exist.
func (r *Remover) DeleteTitle(ctx context.Context, titleID int64, deleteFiles bool) error {
	d, err := r.d.Library.Get(ctx, titleID, library.View{Now: r.d.Clock()})
	if err != nil {
		return err
	}
	ids := make([]int64, len(d.Versions))
	for i, v := range d.Versions {
		ids[i] = v.ID
	}
	if err := r.d.Downloads.CancelVersions(ctx, ids...); err != nil {
		return err
	}
	gone, err := r.d.Library.RemoveTitle(ctx, titleID)
	if err != nil {
		return err
	}
	if r.d.Health != nil {
		if err := r.d.Health.Clear(ctx, health.GoneUpstreamKey(titleID)); err != nil {
			return err
		}
	}
	if r.d.Posters != nil {
		kind := metadata.Movie
		if d.Kind == library.Series {
			kind = metadata.Series
		}
		r.d.Posters.Remove(kind, d.TMDBID)
	}
	if deleteFiles {
		for _, f := range gone.Files {
			removeWithSidecars(f.Path)
		}
		if gone.Folder != "" {
			folder := filepath.Join(gone.RootFolder, gone.Folder)
			_ = os.Remove(folder) // only if nothing else is in it
			r.changed(ctx, folder)
		}
	}
	return nil
}

func (r *Remover) changed(ctx context.Context, folder string) {
	if r.d.FolderChanged != nil {
		r.d.FolderChanged(ctx, folder)
	}
}
