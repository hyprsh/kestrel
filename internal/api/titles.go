package api

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"github.com/hyprsh/kestrel/internal/imports"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/resolution"
	"github.com/hyprsh/kestrel/internal/settings/rootfolders"
)

func intPtr(n int) *int {
	if n == 0 {
		return nil
	}
	return &n
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func slotToAPI(c resolution.Class) oapi.Slot {
	switch c {
	case resolution.HD:
		return oapi.Hd
	case resolution.UHD:
		return oapi.Uhd
	}
	return oapi.Sd
}

func slotFromAPI(s oapi.Slot) resolution.Class {
	switch s {
	case oapi.Hd:
		return resolution.HD
	case oapi.Uhd:
		return resolution.UHD
	}
	return resolution.SD
}

// metaProblem maps a provider failure to the API's problem codes.
func metaProblem(err error) error {
	var me *metadata.Error
	if !errors.As(err, &me) {
		return err
	}
	switch me.Code {
	case metadata.CodeNotFound:
		return problem(http.StatusNotFound, "not_found", "the metadata provider has no such title")
	case metadata.CodeAuth:
		return problem(http.StatusBadGateway, "upstream_unavailable", "The metadata provider refused or lacks an API key; set one in Settings or KESTREL_TMDB_API_KEY")
	case metadata.CodeRateLimited:
		return problem(http.StatusBadGateway, "upstream_unavailable", "The metadata provider is rate limiting Kestrel; try again shortly")
	}
	return problem(http.StatusBadGateway, "upstream_unavailable", "The metadata provider could not be reached: "+me.Message)
}

// view is who is looking at the Library: the household's release-date country and the clock.
func (s *server) view(ctx context.Context) (library.View, error) {
	region, _, err := s.profiles.Region(ctx)
	if err != nil {
		return library.View{}, err
	}
	return library.View{Country: region.Country, Now: s.opts.Clock()}, nil
}

const posterThumb = "w92"

func (s *server) Lookup(ctx context.Context, r oapi.LookupRequestObject) (oapi.LookupResponseObject, error) {
	q := strings.TrimSpace(r.Params.Q)
	if q == "" {
		return nil, invalid("q", "required", "Say what to search for")
	}
	found, err := s.meta.Search(ctx, q)
	if err != nil {
		return nil, metaProblem(err)
	}
	var hits []metadata.SearchResult
	var movieIDs, seriesIDs []int
	for _, f := range found {
		switch {
		case f.Kind == metadata.Movie && (r.Params.Kind == nil || *r.Params.Kind == oapi.Movie):
			movieIDs = append(movieIDs, f.TMDBID)
		case f.Kind == metadata.Series && (r.Params.Kind == nil || *r.Params.Kind == oapi.Series):
			seriesIDs = append(seriesIDs, f.TMDBID)
		default:
			continue
		}
		hits = append(hits, f)
	}
	inMovies, err := s.library.InLibrary(ctx, library.Movie, movieIDs)
	if err != nil {
		return nil, err
	}
	inSeries, err := s.library.InLibrary(ctx, library.Series, seriesIDs)
	if err != nil {
		return nil, err
	}
	tvdb, err := s.bridge.Lookup(ctx, seriesIDs)
	if err != nil {
		return nil, metaProblem(err)
	}
	out := oapi.LookupList{Items: []oapi.LookupResult{}}
	for _, h := range hits {
		res := oapi.LookupResult{
			TmdbId: h.TMDBID, Title: h.Title, Year: intPtr(h.Year),
			Poster: strPtr(s.meta.ImageURL(h.PosterPath, posterThumb)), Addable: true,
		}
		if h.Kind == metadata.Movie {
			res.Kind = oapi.Movie
			if id, ok := inMovies[h.TMDBID]; ok {
				res.InLibrary = &id
			}
		} else {
			res.Kind = oapi.Series
			b := tvdb[h.TMDBID]
			res.TvdbId = intPtr(b.ID)
			if b.ID == 0 {
				res.Addable = false
				res.NotAddableReason = &b.Reason
			}
			if id, ok := inSeries[h.TMDBID]; ok {
				res.InLibrary = &id
			}
		}
		out.Items = append(out.Items, res)
	}
	return oapi.Lookup200JSONResponse(out), nil
}

func (s *server) LookupTitle(ctx context.Context, r oapi.LookupTitleRequestObject) (oapi.LookupTitleResponseObject, error) {
	var (
		name, overview string
		year           int
		rel            metadata.ReleaseDates
		tmdbID         int
		kind           = library.Movie
	)
	if r.Kind == oapi.Series {
		details, err := s.meta.Series(ctx, r.TmdbId)
		if err != nil {
			return nil, metaProblem(err)
		}
		name, overview, year, rel, tmdbID, kind = details.Title, details.Overview, details.Year, details.Ratings, details.TMDBID, library.Series
	} else {
		details, err := s.meta.Movie(ctx, r.TmdbId)
		if err != nil {
			return nil, metaProblem(err)
		}
		name, overview, year, rel, tmdbID = details.Title, details.Overview, details.Year, details.ReleaseDates, details.TMDBID
	}
	region, _, err := s.profiles.Region(ctx)
	if err != nil {
		return nil, err
	}
	kids, _, err := s.profiles.Kids(ctx)
	if err != nil {
		return nil, err
	}
	all, err := s.profiles.List(ctx)
	if err != nil {
		return nil, err
	}
	in, err := s.library.InLibrary(ctx, kind, []int{r.TmdbId})
	if err != nil {
		return nil, err
	}
	sug := library.Suggest(all, kind, rel, region.Country, kids)
	out := oapi.LookupDetail{
		Kind: oapi.TitleKind(kind), TmdbId: tmdbID, Title: name, Year: intPtr(year), Overview: overview,
		Certification: strPtr(sug.Certification), CertificationCountry: strPtr(sug.CertificationCountry),
		Slots: make([]oapi.SuggestedSlot, len(sug.Slots)),
	}
	if id, ok := in[r.TmdbId]; ok {
		out.InLibrary = &id
	}
	for i, sl := range sug.Slots {
		out.Slots[i] = oapi.SuggestedSlot{Slot: slotToAPI(sl.Slot), Profile: sl.Profile.Key, Label: sl.Label, Reason: oapi.SuggestedSlotReason(sl.Reason)}
	}
	return oapi.LookupTitle200JSONResponse(out), nil
}

func rowToAPI(r library.Row) oapi.TitleRow {
	summary := func(s *library.SlotState) *oapi.SlotSummary {
		if s == nil {
			return nil
		}
		return &oapi.SlotSummary{VersionId: s.VersionID, Profile: s.Profile, State: oapi.SlotState(s.State), LongMissing: s.LongMissing}
	}
	out := oapi.TitleRow{
		Id: r.ID, Kind: oapi.TitleKind(r.Kind), Title: r.Title, PrimaryTitle: r.PrimaryTitle, Year: intPtr(r.Year),
		WantedSince: r.WantedSince, AddedAt: r.AddedAt,
	}
	out.Slots.Sd, out.Slots.Hd, out.Slots.Uhd = summary(r.Slots[resolution.SD]), summary(r.Slots[resolution.HD]), summary(r.Slots[resolution.UHD])
	return out
}

func (s *server) ListTitles(ctx context.Context, r oapi.ListTitlesRequestObject) (oapi.ListTitlesResponseObject, error) {
	limit := 100
	if r.Params.Limit != nil {
		limit = *r.Params.Limit
	}
	if limit < 1 || limit > 10000 {
		return nil, invalid("limit", "invalid", "limit is between 1 and 10000")
	}
	offset := 0
	if r.Params.Cursor != nil && *r.Params.Cursor != "" {
		raw, err := base64.RawURLEncoding.DecodeString(*r.Params.Cursor)
		n, convErr := strconv.Atoi(string(raw))
		if err != nil || convErr != nil || n < 0 {
			return nil, invalid("cursor", "invalid", "The cursor is not one this server gave out")
		}
		offset = n
	}
	var f library.Filter
	if r.Params.Kind != nil {
		f.Kind = library.Kind(*r.Params.Kind)
	}
	if r.Params.Q != nil {
		f.Text = strings.TrimSpace(*r.Params.Q)
	}
	f.Wanted = r.Params.Wanted != nil && *r.Params.Wanted
	f.LongMissing = r.Params.LongMissing != nil && *r.Params.LongMissing
	if r.Params.Sort != nil {
		switch *r.Params.Sort {
		case "added_at":
		case "wanted_since":
			f.ByWantedSince = true
		default:
			return nil, invalid("sort", "invalid", "sort is added_at or wanted_since")
		}
	}
	view, err := s.view(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.library.List(ctx, view, f)
	if err != nil {
		return nil, err
	}
	out := oapi.TitleList{Items: []oapi.TitleRow{}}
	if offset > len(rows) {
		offset = len(rows)
	}
	end := offset + limit
	if end < len(rows) {
		cursor := base64.RawURLEncoding.EncodeToString([]byte(strconv.Itoa(end)))
		out.NextCursor = &cursor
	} else {
		end = len(rows)
	}
	for _, row := range rows[offset:end] {
		out.Items = append(out.Items, rowToAPI(row))
	}
	return oapi.ListTitles200JSONResponse(out), nil
}

var releaseTypeNames = map[metadata.ReleaseType]oapi.ReleaseDateEntryType{
	metadata.Premiere:          "premiere",
	metadata.TheatricalLimited: "theatrical_limited",
	metadata.Theatrical:        "theatrical",
	metadata.Digital:           "digital",
	metadata.Physical:          "physical",
	metadata.TV:                "tv",
}

func detailToAPI(d library.Detail, country string) oapi.TitleDetail {
	_, cert := d.ReleaseDates.Certification(country)
	out := oapi.TitleDetail{
		Id: d.ID, Kind: oapi.TitleKind(d.Kind), TmdbId: intPtr(d.TMDBID), TvdbId: intPtr(d.TVDBID), ImdbId: strPtr(d.IMDbID),
		Title: d.Title, OriginalTitle: d.OriginalTitle, PrimaryTitle: d.PrimaryTitle, Year: intPtr(d.Year),
		OriginalLanguage: d.OriginalLanguage, Overview: d.Overview, Runtime: intPtr(d.Runtime), HasPoster: d.PosterPath != "",
		Monitored: d.Monitored, MetadataFrozen: d.MetadataFrozen, RootFolder: d.RootFolder, Folder: strPtr(d.Folder),
		AddedAt: d.AddedAt, RefreshedAt: d.RefreshedAt, Certification: strPtr(cert),
		ReleaseDates: make([]oapi.ReleaseDateEntry, 0, len(d.ReleaseDates)), Requests: []oapi.RequestOrigin{}, Versions: make([]oapi.VersionDetail, 0, len(d.Versions)),
		Seasons: make([]oapi.Season, 0, len(d.Seasons)),
	}
	if d.Kind == library.Series {
		mode := oapi.SeriesMonitor(d.SeriesMonitor)
		out.SeriesMonitor = &mode
		for _, se := range d.Seasons {
			out.Seasons = append(out.Seasons, oapi.Season{Number: se.Number, Monitored: se.Monitored})
		}
	}
	for _, r := range d.ReleaseDates {
		out.ReleaseDates = append(out.ReleaseDates, oapi.ReleaseDateEntry{
			Country: r.Country, Type: releaseTypeNames[r.Type], Date: r.Date, Certification: strPtr(r.Certification),
		})
	}
	for _, v := range d.Versions {
		ov := oapi.VersionDetail{
			Id: v.ID, Slot: slotToAPI(v.Slot), Profile: v.Profile, State: oapi.SlotState(v.State),
			LongMissing: v.LongMissing, WantedSince: v.WantedSince, AddedAt: v.AddedAt,
		}
		if f := v.File; f != nil {
			quality, languages := imports.Facts(f.ParsedRelease, f.Probe)
			ov.File = &oapi.FileSummary{
				Path: f.Path, Size: f.Size, ReleaseName: f.ReleaseName, Score: f.Score, ImportedAt: f.ImportedAt,
				Quality: strPtr(quality), Languages: &languages, Misfit: &f.Misfit,
			}
		}
		out.Versions = append(out.Versions, ov)
	}
	return out
}

func (s *server) GetTitle(ctx context.Context, r oapi.GetTitleRequestObject) (oapi.GetTitleResponseObject, error) {
	view, err := s.view(ctx)
	if err != nil {
		return nil, err
	}
	d, err := s.library.Get(ctx, r.Id, view)
	if errors.Is(err, library.ErrNotFound) {
		return nil, problem(http.StatusNotFound, "not_found", "no such Title")
	}
	if err != nil {
		return nil, err
	}
	out := detailToAPI(d, view.Country)
	if err := s.origins(ctx, &out); err != nil {
		return nil, err
	}
	return oapi.GetTitle200JSONResponse(out), nil
}

func (s *server) CreateTitle(ctx context.Context, r oapi.CreateTitleRequestObject) (oapi.CreateTitleResponseObject, error) {
	if r.Body == nil {
		return nil, invalid("body", "required", "a body is required")
	}
	b := r.Body
	if len(b.Versions) == 0 {
		return nil, invalid("versions", "required", "Pick at least one Slot")
	}
	all, err := s.profiles.List(ctx)
	if err != nil {
		return nil, err
	}
	var specs []library.VersionSpec
	seen := map[resolution.Class]bool{}
	for i, v := range b.Versions {
		slot := slotFromAPI(v.Slot)
		if seen[slot] {
			return nil, invalid(fmt.Sprintf("versions[%d].slot", i), "duplicate", "A Slot holds one Version")
		}
		if err := profileProblem(fmt.Sprintf("versions[%d].profile", i), all, v.Profile, slot); err != nil {
			return nil, err
		}
		seen[slot] = true
		specs = append(specs, library.VersionSpec{Slot: slot, Profile: v.Profile})
	}
	roots, _, err := s.rootFolders.Get(ctx)
	if err != nil {
		return nil, err
	}
	noun := "Movie"
	if b.Kind == oapi.Series {
		noun = "Series"
	}
	requested := ""
	if b.RootFolder != nil {
		requested = *b.RootFolder
	}
	root, err := roots.Pick(rootfolders.Kind(b.Kind), requested)
	switch {
	case errors.Is(err, rootfolders.ErrNotConfigured):
		return nil, invalid("root_folder", "not_found", "That is not one of the "+noun+" Root folders")
	case errors.Is(err, rootfolders.ErrNoneSet):
		return nil, invalid("root_folder", "required", "Set a "+noun+" Root folder in Settings first")
	case err != nil:
		return nil, err
	}
	if b.Kind == oapi.Series {
		return s.createSeries(ctx, b, specs, root)
	}

	details, err := s.meta.Movie(ctx, b.TmdbId)
	if err != nil {
		return nil, metaProblem(err)
	}
	region, _, err := s.profiles.Region(ctx)
	if err != nil {
		return nil, err
	}
	id, err := s.library.AddMovie(ctx, library.AddMovie{
		Details: details, PrimaryLanguage: string(region.Primary), Versions: specs, RootFolder: root,
	})
	if err != nil {
		return nil, addProblem(err)
	}
	return s.added(ctx, newTitle{id, metadata.Movie, details.TMDBID, details.PosterPath, region.Country})
}

// addProblem is the 409 for a Title already in the Library; any other error as it is.
func addProblem(err error) error {
	var exists *library.ExistsError
	if errors.As(err, &exists) {
		return problem(http.StatusConflict, "conflict", fmt.Sprintf("Already in the Library as title %d", exists.ID))
	}
	return err
}

// newTitle is a Title CreateTitle just added, of either kind.
type newTitle struct {
	id         int64
	kind       metadata.Kind
	tmdbID     int
	posterPath string
	country    string
}

// added is the end of CreateTitle for both kinds: the search on add, the
// poster and the new Title read back.
func (s *server) added(ctx context.Context, t newTitle) (oapi.CreateTitleResponseObject, error) {
	s.jobs.Kick(jobs.Search) // search on add: the new Versions are due now
	// The poster is a nicety: a failed download is retried when it is first asked for.
	if _, err := s.posters.Ensure(ctx, t.kind, t.tmdbID, t.posterPath); err != nil && !errors.Is(err, metadata.ErrNoPoster) {
		s.opts.Logger.Warn("poster download failed", "tmdb_id", t.tmdbID, "err", err)
	}
	d, err := s.library.Get(ctx, t.id, library.View{Country: t.country, Now: s.opts.Clock()})
	if err != nil {
		return nil, err
	}
	return oapi.CreateTitle201JSONResponse(detailToAPI(d, t.country)), nil
}

func (s *server) GetTitlePoster(ctx context.Context, r oapi.GetTitlePosterRequestObject) (oapi.GetTitlePosterResponseObject, error) {
	view, err := s.view(ctx)
	if err != nil {
		return nil, err
	}
	d, err := s.library.Get(ctx, r.Id, view)
	if errors.Is(err, library.ErrNotFound) {
		return nil, problem(http.StatusNotFound, "not_found", "no such Title")
	}
	if err != nil {
		return nil, err
	}
	kind := metadata.Movie
	if d.Kind == library.Series {
		kind = metadata.Series
	}
	path, err := s.posters.Ensure(ctx, kind, d.TMDBID, d.PosterPath)
	if errors.Is(err, metadata.ErrNoPoster) {
		return nil, problem(http.StatusNotFound, "not_found", "this Title has no poster")
	}
	if err != nil {
		return nil, metaProblem(err)
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	return oapi.GetTitlePoster200ImagejpegResponse{Body: f, ContentLength: info.Size()}, nil
}
