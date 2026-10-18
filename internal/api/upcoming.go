package api

import (
	"context"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/library"
)

// recentImports is how many Imports "Recently added" shows.
const recentImports = 10

// ListUpcoming is the agenda: episodes airing and typed Movie release dates in a window.
func (s *server) ListUpcoming(ctx context.Context, r oapi.ListUpcomingRequestObject) (oapi.ListUpcomingResponseObject, error) {
	view, err := s.view(ctx)
	if err != nil {
		return nil, err
	}
	var asked struct{ from, to *time.Time }
	if r.Params.From != nil {
		asked.from = &r.Params.From.Time
	}
	if r.Params.To != nil {
		asked.to = &r.Params.To.Time
	}
	from, to := library.UpcomingWindow(view.Now, asked.from, asked.to)
	if to.Before(from) {
		return nil, invalid("to", "invalid", "to must not be before from")
	}
	entries, err := s.library.Upcoming(ctx, view, from, to)
	if err != nil {
		return nil, err
	}
	out := oapi.UpcomingList{From: openapi_types.Date{Time: from}, To: openapi_types.Date{Time: to}, Items: make([]oapi.UpcomingItem, 0, len(entries))}
	for _, e := range entries {
		item := oapi.UpcomingItem{
			Date: openapi_types.Date{Time: e.Date}, Kind: oapi.TitleKind(e.Kind), TitleId: e.TitleID, Title: e.Title,
			Year: intPtr(e.Year), Released: e.Released,
		}
		if e.Kind == library.Movie {
			rt := oapi.UpcomingItemReleaseType(e.ReleaseType)
			item.ReleaseType = &rt
			if !e.SearchableFrom.IsZero() {
				item.SearchableFrom = &openapi_types.Date{Time: e.SearchableFrom}
			}
		} else {
			season, episode, name := e.Season, e.Episode, e.EpisodeName
			item.Season, item.Episode, item.EpisodeName = &season, &episode, &name
		}
		out.Items = append(out.Items, item)
	}
	return oapi.ListUpcoming200JSONResponse(out), nil
}

// ListRecentlyAdded is the last few Imports.
func (s *server) ListRecentlyAdded(ctx context.Context, _ oapi.ListRecentlyAddedRequestObject) (oapi.ListRecentlyAddedResponseObject, error) {
	rows, err := s.library.RecentImports(ctx, recentImports)
	if err != nil {
		return nil, err
	}
	out := oapi.RecentList{Items: make([]oapi.RecentItem, 0, len(rows))}
	for _, r := range rows {
		out.Items = append(out.Items, oapi.RecentItem{
			TitleId: r.TitleID, Title: r.Title, Year: intPtr(r.Year), Kind: oapi.TitleKind(r.Kind), Slot: oapi.Slot(r.Slot),
			ReleaseName: r.Release, Score: r.Score, ScoreDelta: r.ScoreDelta, Files: r.Files, IsUpgrade: r.IsUpgrade, ImportedAt: r.ImportedAt,
		})
	}
	return oapi.ListRecentlyAdded200JSONResponse(out), nil
}
