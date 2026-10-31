package api

import (
	"context"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/imports"
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
	agenda, err := s.library.Upcoming(ctx, view, from, to)
	if err != nil {
		return nil, err
	}
	items := make([]oapi.UpcomingItem, 0, len(agenda.Entries))
	for _, e := range agenda.Entries {
		markers := make([]oapi.UpcomingItemMarkers, 0, len(e.Markers))
		for _, m := range e.Markers {
			markers = append(markers, oapi.UpcomingItemMarkers(m))
		}
		slots, dates := upcomingSlots(e.Slots), make([]oapi.UpcomingDate, 0, len(e.Dates))
		item := oapi.UpcomingItem{
			Date: openapi_types.Date{Time: e.Date}, Kind: oapi.TitleKind(e.Kind), TitleId: e.TitleID, Title: e.Title,
			Year: intPtr(e.Year), Released: e.Released, HasPoster: &e.HasPoster, Network: strPtr(e.Network), Overview: strPtr(e.Overview),
			Slots: &slots, Searchable: &e.Searchable, AirAt: e.AirAt, Markers: &markers, Dates: &dates,
		}
		if e.Kind == library.Movie {
			rt := oapi.UpcomingItemReleaseType(e.ReleaseType)
			item.ReleaseType = &rt
			if !e.SearchableFrom.IsZero() {
				item.SearchableFrom = &openapi_types.Date{Time: e.SearchableFrom}
			}
			for _, d := range e.Dates {
				dates = append(dates, oapi.UpcomingDate{ReleaseType: oapi.UpcomingDateReleaseType(d.Type), Date: openapi_types.Date{Time: d.Date}})
			}
		} else {
			season, episode, name, id := e.Season, e.Episode, e.EpisodeName, e.EpisodeID
			item.EpisodeId = &id
			item.Season, item.Episode, item.EpisodeName = &season, &episode, &name
		}
		items = append(items, item)
	}
	undated := make([]oapi.UndatedItem, 0, len(agenda.Undated))
	for _, u := range agenda.Undated {
		undated = append(undated, oapi.UndatedItem{
			Kind: oapi.TitleKind(u.Kind), TitleId: u.TitleID, Title: u.Title, Year: intPtr(u.Year), HasPoster: u.HasPoster,
			Network: strPtr(u.Network), Reason: oapi.UndatedItemReason(u.Reason), Episodes: u.Episodes, Slots: upcomingSlots(u.Slots),
		})
	}
	out := oapi.UpcomingList{From: openapi_types.Date{Time: from}, To: openapi_types.Date{Time: to}, Items: items, Undated: &undated}
	return oapi.ListUpcoming200JSONResponse(out), nil
}

// upcomingSlots is the state of each Version for the wire, with the quality of an Imported one's file.
func upcomingSlots(in []library.EntrySlot) []oapi.UpcomingSlot {
	out := make([]oapi.UpcomingSlot, 0, len(in))
	for _, s := range in {
		var quality *string
		if s.State == library.EntryImported {
			q, _ := imports.Facts(s.ParsedRelease, "")
			quality = strPtr(q)
		}
		out = append(out, oapi.UpcomingSlot{
			Slot: oapi.Slot(s.Slot.Key()), VersionId: s.VersionID, State: oapi.UpcomingSlotState(s.State),
			WantedSince: s.WantedSince, LongMissing: s.LongMissing, Quality: quality,
		})
	}
	return out
}

// ListRecentlyAdded is the last few Imports.
func (s *server) ListRecentlyAdded(ctx context.Context, _ oapi.ListRecentlyAddedRequestObject) (oapi.ListRecentlyAddedResponseObject, error) {
	rows, err := s.library.RecentImports(ctx, recentImports)
	if err != nil {
		return nil, err
	}
	total, err := s.library.CountRecentImports(ctx, s.opts.Clock())
	if err != nil {
		return nil, err
	}
	out := oapi.RecentList{Items: make([]oapi.RecentItem, 0, len(rows)), Total: total}
	for _, r := range rows {
		out.Items = append(out.Items, oapi.RecentItem{
			TitleId: r.TitleID, Title: r.Title, Year: intPtr(r.Year), Kind: oapi.TitleKind(r.Kind), HasPoster: r.HasPoster, Slot: oapi.Slot(r.Slot),
			ReleaseName: r.Release, Score: r.Score, ScoreDelta: r.ScoreDelta, Files: r.Files, IsUpgrade: r.IsUpgrade, ImportedAt: r.ImportedAt,
		})
	}
	return oapi.ListRecentlyAdded200JSONResponse(out), nil
}
