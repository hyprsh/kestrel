package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

// Reasons a Series cannot be added, for `not_addable_reason`.
const (
	reasonNotOnTVDB       = "not_on_tvdb"
	reasonTVDBUnavailable = "tvdb_unavailable"
)

// bridged is a Series' TheTVDB id, or why it has none.
type bridged struct {
	id     int
	reason string
}

// bridge finds a TMDB series' TheTVDB id: TMDB's own external ids first, else a
// TheTVDB remote-id search by IMDb id. A series with neither is not on TheTVDB.
func (s *server) bridge(ctx context.Context, tvdbID int, imdbID string) (bridged, error) {
	if tvdbID != 0 {
		return bridged{id: tvdbID}, nil
	}
	if imdbID == "" {
		return bridged{reason: reasonNotOnTVDB}, nil
	}
	id, ok, err := s.tvdb.SeriesByIMDb(ctx, imdbID)
	if err != nil {
		return bridged{}, err
	}
	if !ok {
		return bridged{reason: reasonNotOnTVDB}, nil
	}
	return bridged{id: id}, nil
}

// bridgeAll bridges every series of a search in parallel. A TMDB series that
// has vanished is not on TheTVDB; a TheTVDB outage greys the result out instead of failing the search.
func (s *server) bridgeAll(ctx context.Context, tmdbIDs []int) (map[int]bridged, error) {
	out := map[int]bridged{}
	var (
		mu       sync.Mutex
		wg       sync.WaitGroup
		firstErr error
		sem      = make(chan struct{}, 8)
	)
	for _, id := range tmdbIDs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			var b bridged
			ext, err := s.meta.SeriesExternalIDs(ctx, id)
			var me *metadata.Error
			switch {
			case errors.As(err, &me) && me.Code == metadata.CodeNotFound:
				b = bridged{reason: reasonNotOnTVDB}
				err = nil
			case err == nil:
				b, err = s.bridge(ctx, ext.TVDBID, ext.IMDbID)
				if err != nil {
					s.opts.Logger.Warn("TheTVDB lookup failed", "tmdb_id", id, "err", err)
					b, err = bridged{reason: reasonTVDBUnavailable}, nil
				}
			}
			mu.Lock()
			defer mu.Unlock()
			if err != nil && firstErr == nil {
				firstErr = metaProblem(err)
			}
			out[id] = b
		}()
	}
	wg.Wait()
	return out, firstErr
}

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
	br, err := s.bridge(ctx, details.TVDBID, details.IMDbID)
	if err != nil {
		return nil, metaProblem(err)
	}
	if br.id == 0 {
		return nil, invalid("tmdb_id", reasonNotOnTVDB, "This Series is not on TheTVDB, so Kestrel cannot add it")
	}
	tv, err := s.tvdb.Series(ctx, br.id)
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
	var exists *library.ExistsError
	if errors.As(err, &exists) {
		return nil, problem(http.StatusConflict, "conflict", fmt.Sprintf("Already in the Library as title %d", exists.ID))
	}
	if err != nil {
		return nil, err
	}
	if _, err := s.posters.Ensure(ctx, metadata.Series, details.TMDBID, details.PosterPath); err != nil && !errors.Is(err, metadata.ErrNoPoster) {
		s.opts.Logger.Warn("poster download failed", "tmdb_id", details.TMDBID, "err", err)
	}
	d, err := s.library.Get(ctx, id, library.View{Country: region.Country, Now: s.opts.Clock()})
	if err != nil {
		return nil, err
	}
	return oapi.CreateTitle201JSONResponse(detailToAPI(d, region.Country)), nil
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
