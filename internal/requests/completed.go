package requests

import (
	"context"
	"path/filepath"
	"slices"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/requests/db"
)

// CompletedTitle is a Title with a Completed Slot in some Request, and who asked.
type CompletedTitle struct {
	TitleID        int64
	Kind           library.Kind
	TMDBID, TVDBID int
	// Folder is the Title's folder, the Root folder joined with the folder name.
	Folder string
	// Requesters are the names of those whose accepted Requests hold a
	// Completed Slot of the Title, in the order they asked, without repeats.
	Requesters []string
}

// CompletedTitles lists the Titles with a Completed Slot that have a folder,
// in Title order. A Slot is Completed once it was filled, and it is read that
// way: the Requests are viewed first, which is what stamps a Slot that has
// just been filled.
func (s *Service) CompletedTitles(ctx context.Context) ([]CompletedTitle, error) {
	if _, err := s.List(ctx, Filter{States: []State{StateCompleted}}); err != nil {
		return nil, err
	}
	rows, err := db.New(s.d.Store.Read()).ListCompletedTitles(ctx)
	if err != nil {
		return nil, err
	}
	var out []CompletedTitle
	for _, r := range rows {
		if len(out) == 0 || out[len(out)-1].TitleID != r.TitleID {
			out = append(out, CompletedTitle{
				TitleID: r.TitleID, Kind: library.Kind(r.Kind), TMDBID: int(r.TmdbID.Int64), TVDBID: int(r.TvdbID.Int64),
				Folder: filepath.Join(r.RootFolder, r.TitleFolder.String),
			})
		}
		t := &out[len(out)-1]
		if r.RequesterName != "" && !slices.Contains(t.Requesters, r.RequesterName) {
			t.Requesters = append(t.Requesters, r.RequesterName)
		}
	}
	return out, nil
}
