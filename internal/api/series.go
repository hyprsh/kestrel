package api

import (
	"context"
	"errors"
	"fmt"
	"github.com/hyprsh/kestrel/internal/slot"
	"net/http"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/imports"
	"github.com/hyprsh/kestrel/internal/jobs"
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
	var seasons []int
	if b.Seasons != nil {
		seasons = append(make([]int, 0, len(*b.Seasons)), *b.Seasons...)
		for _, n := range seasons {
			if n < 0 {
				return nil, invalid("seasons", "invalid", "Seasons are numbered from 0")
			}
		}
	}
	details, err := s.meta.Series(ctx, b.TmdbId)
	if err != nil {
		return nil, metaProblem(err)
	}
	tvdbID, err := metadata.TVDBIDOf(ctx, s.tvdb, details.TVDBID, details.IMDbID)
	if err != nil {
		return nil, metaProblem(err)
	}
	if tvdbID == 0 {
		return nil, invalid("tmdb_id", metadata.ReasonNotOnTVDB, "This Series is not on TheTVDB, so Kestrel cannot add it")
	}
	region, _, err := s.profiles.Region(ctx)
	if err != nil {
		return nil, err
	}
	tv, err := metadata.SeriesIn(ctx, s.tvdb, tvdbID, string(region.Primary))
	if err != nil {
		return nil, metaProblem(err)
	}
	id, err := s.library.AddSeries(ctx, library.AddSeries{
		TMDB: details, TVDB: tv, PrimaryLanguage: string(region.Primary), Monitor: mode, Versions: specs, RootFolder: root,
		Seasons: seasons,
	})
	var unknown *library.UnknownSeasonError
	if errors.As(err, &unknown) {
		return nil, invalid("seasons", "unknown", fmt.Sprintf("The Series has no season %d", unknown.Season))
	}
	if err != nil {
		return nil, addProblem(err)
	}
	return s.added(ctx, newTitle{id, metadata.Series, details.TMDBID, details.PosterPath, region.Country})
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
		out := &oapi.EpisodeCell{State: oapi.SlotState(c.State), Score: c.Score}
		if f := c.File; f != nil {
			quality, _ := imports.Facts(f.ParsedRelease, "")
			out.File = &oapi.EpisodeFile{Id: f.ID, Path: f.Path, Size: f.Size, Quality: strPtr(quality), EpisodeIds: f.EpisodeIDs}
		}
		return out
	}
	for _, e := range eps {
		oe := oapi.Episode{
			Id: e.ID, Season: e.Season, Number: e.Number, Name: e.Name, Monitored: e.Monitored,
			PrimaryName: e.PrimaryName, OriginalName: e.Name, Placeholder: e.Placeholder,
		}
		if e.AirDate != nil {
			oe.AirDate = &openapi_types.Date{Time: *e.AirDate}
		}
		oe.Cells.Standard, oe.Cells.N4k = cell(e.Cells[slot.Standard]), cell(e.Cells[slot.FourK])
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
	if r.Body.RootFolder != nil {
		// First, so a refused move leaves the other fields unapplied too.
		if err := s.moveTitle(ctx, r.Id, *r.Body.RootFolder); err != nil {
			return nil, err
		}
	}
	if r.Body.MetadataFrozen != nil {
		if err := s.refresher.SetFrozen(ctx, r.Id, *r.Body.MetadataFrozen); err != nil {
			return nil, seriesProblem(err)
		}
	}
	if r.Body.Monitored != nil {
		err := s.library.SetMovieMonitored(ctx, r.Id, *r.Body.Monitored)
		if errors.Is(err, library.ErrNotAMovie) {
			return nil, invalid("monitored", "not_a_movie", "A Series is monitored through series_monitor")
		}
		if err != nil {
			return nil, seriesProblem(err)
		}
		if *r.Body.Monitored {
			s.jobs.Kick(jobs.Search) // its Versions are due now
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
