package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/health"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

func (s *server) createSeries(ctx context.Context, b *oapi.TitleCreate, specs []library.VersionSpec, root string) (oapi.CreateTitleResponseObject, error) {
	mode := library.MonitorAll
	if b.SeriesMonitor != nil {
		mode = library.Monitor(*b.SeriesMonitor)
	}
	if !mode.Valid() {
		return nil, invalid("series_monitor", "invalid", "Monitor all, future or none")
	}
	details, err := s.meta.Series(ctx, b.TmdbId)
	if err != nil {
		return nil, metaProblem(err)
	}
	tvdbID, err := s.bridge.TVDBID(ctx, details.TVDBID, details.IMDbID)
	if err != nil {
		return nil, metaProblem(err)
	}
	if tvdbID == 0 {
		return nil, invalid("tmdb_id", metadata.ReasonNotOnTVDB, "This Series is not on TheTVDB, so Kestrel cannot add it")
	}
	tv, err := s.tvdb.Series(ctx, tvdbID)
	if err != nil {
		return nil, metaProblem(err)
	}
	region, _, err := s.profiles.Region(ctx)
	if err != nil {
		return nil, err
	}
	id, err := s.library.AddSeries(ctx, library.AddSeries{
		TMDB: details, TVDB: tv, PrimaryLanguage: string(region.Primary), Monitor: mode, Versions: specs, RootFolder: root,
	})
	return s.added(ctx, id, err, metadata.Series, details.TMDBID, details.PosterPath, region.Country)
}

// seriesProblem maps the library's Series errors to problems.
func seriesProblem(err error) error {
	switch {
	case errors.Is(err, library.ErrNotFound):
		return problem(http.StatusNotFound, "not_found", "no such Title, season or episode")
	case errors.Is(err, library.ErrNotASeries):
		return invalid("title", "not_a_series", "Only a Series has seasons, episodes and a monitoring mode")
	}
	return err
}

func (s *server) ListEpisodes(ctx context.Context, r oapi.ListEpisodesRequestObject) (oapi.ListEpisodesResponseObject, error) {
	view, err := s.view(ctx)
	if err != nil {
		return nil, err
	}
	eps, err := s.library.Episodes(ctx, r.Id, view)
	if errors.Is(err, library.ErrNotASeries) {
		return nil, problem(http.StatusNotFound, "not_found", "a Movie has no episodes")
	}
	if err != nil {
		return nil, seriesProblem(err)
	}
	out := oapi.EpisodeList{Items: make([]oapi.Episode, 0, len(eps))}
	cell := func(c *library.EpisodeCell) *oapi.EpisodeCell {
		if c == nil {
			return nil
		}
		return &oapi.EpisodeCell{State: oapi.SlotState(c.State), Score: c.Score}
	}
	for _, e := range eps {
		oe := oapi.Episode{Id: e.ID, Season: e.Season, Number: e.Number, Name: e.Name, Monitored: e.Monitored}
		if e.AirDate != nil {
			oe.AirDate = &openapi_types.Date{Time: *e.AirDate}
		}
		oe.Cells.Sd, oe.Cells.Hd, oe.Cells.Uhd = cell(e.Cells[0]), cell(e.Cells[1]), cell(e.Cells[2])
		out.Items = append(out.Items, oe)
	}
	return oapi.ListEpisodes200JSONResponse(out), nil
}

func (s *server) MonitorEpisodes(ctx context.Context, r oapi.MonitorEpisodesRequestObject) (oapi.MonitorEpisodesResponseObject, error) {
	if r.Body == nil {
		return nil, invalid("body", "required", "a body is required")
	}
	if err := s.library.SetEpisodesMonitored(ctx, r.Id, r.Body.EpisodeIds, r.Body.Monitored); err != nil {
		return nil, seriesProblem(err)
	}
	return oapi.MonitorEpisodes204Response{}, nil
}

func (s *server) PatchSeason(ctx context.Context, r oapi.PatchSeasonRequestObject) (oapi.PatchSeasonResponseObject, error) {
	if r.Body == nil {
		return nil, invalid("body", "required", "a body is required")
	}
	if err := s.library.SetSeasonMonitored(ctx, r.Id, r.Season, r.Body.Monitored); err != nil {
		return nil, seriesProblem(err)
	}
	return oapi.PatchSeason204Response{}, nil
}

func (s *server) PatchTitle(ctx context.Context, r oapi.PatchTitleRequestObject) (oapi.PatchTitleResponseObject, error) {
	if r.Body == nil {
		return nil, invalid("body", "required", "a body is required")
	}
	if r.Body.MetadataFrozen != nil {
		if err := s.library.SetMetadataFrozen(ctx, r.Id, *r.Body.MetadataFrozen); err != nil {
			return nil, seriesProblem(err)
		}
		if *r.Body.MetadataFrozen {
			// "Keep as is" settles the Title gone upstream row.
			if err := s.health.Clear(ctx, health.GoneUpstreamKey(r.Id)); err != nil {
				return nil, err
			}
		}
	}
	if r.Body.SeriesMonitor != nil {
		mode := library.Monitor(*r.Body.SeriesMonitor)
		if !mode.Valid() {
			return nil, invalid("series_monitor", "invalid", "Monitor all, future or none")
		}
		if err := s.library.SetSeriesMonitor(ctx, r.Id, mode); err != nil {
			return nil, seriesProblem(err)
		}
	}
	view, err := s.view(ctx)
	if err != nil {
		return nil, err
	}
	d, err := s.library.Get(ctx, r.Id, view)
	if err != nil {
		return nil, seriesProblem(err)
	}
	out := detailToAPI(d, view.Country)
	if err := s.origins(ctx, &out); err != nil {
		return nil, err
	}
	return oapi.PatchTitle200JSONResponse(out), nil
}
