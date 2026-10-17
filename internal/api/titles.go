package api

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/resolution"
	"github.com/hyprsh/kestrel/internal/scoring/profiles"
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
	out := oapi.LookupList{Items: []oapi.LookupResult{}}
	// Series cannot be added until their ticket lands, so they are not offered.
	if r.Params.Kind != nil && *r.Params.Kind != oapi.Movie {
		return oapi.Lookup200JSONResponse(out), nil
	}
	found, err := s.meta.Search(ctx, q)
	if err != nil {
		return nil, metaProblem(err)
	}
	var movies []metadata.SearchResult
	var ids []int
	for _, f := range found {
		if f.Kind == metadata.Movie {
			movies = append(movies, f)
			ids = append(ids, f.TMDBID)
		}
	}
	in, err := s.library.InLibrary(ctx, library.Movie, ids)
	if err != nil {
		return nil, err
	}
	for _, m := range movies {
		res := oapi.LookupResult{
			Kind: oapi.Movie, TmdbId: m.TMDBID, Title: m.Title, Year: intPtr(m.Year),
			Poster: strPtr(s.meta.ImageURL(m.PosterPath, posterThumb)), Addable: true,
		}
		if id, ok := in[m.TMDBID]; ok {
			res.InLibrary = &id
		}
		out.Items = append(out.Items, res)
	}
	return oapi.Lookup200JSONResponse(out), nil
}

func (s *server) LookupTitle(ctx context.Context, r oapi.LookupTitleRequestObject) (oapi.LookupTitleResponseObject, error) {
	if r.Kind != oapi.Movie {
		return nil, problem(http.StatusNotFound, "not_found", "Series cannot be added yet")
	}
	details, err := s.meta.Movie(ctx, r.TmdbId)
	if err != nil {
		return nil, metaProblem(err)
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
	in, err := s.library.InLibrary(ctx, library.Movie, []int{r.TmdbId})
	if err != nil {
		return nil, err
	}
	sug := library.Suggest(all, library.Movie, details.ReleaseDates, region.Country, kids)
	out := oapi.LookupDetail{
		Kind: oapi.Movie, TmdbId: details.TMDBID, Title: details.Title, Year: intPtr(details.Year), Overview: details.Overview,
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
		ReleaseDates: make([]oapi.ReleaseDateEntry, 0, len(d.ReleaseDates)), Versions: make([]oapi.VersionDetail, 0, len(d.Versions)),
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
			ov.File = &oapi.FileSummary{Path: f.Path, Size: f.Size, ReleaseName: f.ReleaseName, Score: f.Score, ImportedAt: f.ImportedAt}
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
	return oapi.GetTitle200JSONResponse(detailToAPI(d, view.Country)), nil
}

func (s *server) CreateTitle(ctx context.Context, r oapi.CreateTitleRequestObject) (oapi.CreateTitleResponseObject, error) {
	if r.Body == nil {
		return nil, invalid("body", "required", "a body is required")
	}
	b := r.Body
	if b.Kind != oapi.Movie {
		return nil, invalid("kind", "unsupported", "Only Movies can be added so far")
	}
	if len(b.Versions) == 0 {
		return nil, invalid("versions", "required", "Pick at least one Slot")
	}
	all, err := s.profiles.List(ctx)
	if err != nil {
		return nil, err
	}
	byKey := map[string]profiles.Profile{}
	for _, p := range all {
		byKey[p.Key] = p
	}
	var specs []library.VersionSpec
	seen := map[resolution.Class]bool{}
	for i, v := range b.Versions {
		slot := slotFromAPI(v.Slot)
		p, ok := byKey[v.Profile]
		switch {
		case seen[slot]:
			return nil, invalid(fmt.Sprintf("versions[%d].slot", i), "duplicate", "A Slot holds one Version")
		case !ok:
			return nil, invalid(fmt.Sprintf("versions[%d].profile", i), "not_found", "No such Profile")
		case p.Slot != slot:
			return nil, invalid(fmt.Sprintf("versions[%d].profile", i), "wrong_slot", "That Profile belongs to another Slot")
		case !p.Enabled:
			return nil, invalid(fmt.Sprintf("versions[%d].profile", i), "disabled", "That Profile is disabled")
		}
		seen[slot] = true
		specs = append(specs, library.VersionSpec{Slot: slot, Profile: v.Profile})
	}
	roots, _, err := s.rootFolders.Get(ctx)
	if err != nil {
		return nil, err
	}
	root := ""
	if b.RootFolder != nil && *b.RootFolder != "" {
		root = *b.RootFolder
		found := false
		for _, f := range roots.Movies {
			found = found || f == root
		}
		if !found {
			return nil, invalid("root_folder", "not_found", "That is not one of the Movie Root folders")
		}
	} else if len(roots.Movies) > 0 {
		root = roots.Movies[0]
	} else {
		return nil, invalid("root_folder", "required", "Set a Movie Root folder in Settings first")
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
	var exists *library.ExistsError
	if errors.As(err, &exists) {
		return nil, problem(http.StatusConflict, "conflict", fmt.Sprintf("Already in the Library as title %d", exists.ID))
	}
	if err != nil {
		return nil, err
	}
	// The poster is a nicety: a failed download is retried when it is first asked for.
	if _, err := s.posters.Ensure(ctx, metadata.Movie, details.TMDBID, details.PosterPath); err != nil && !errors.Is(err, metadata.ErrNoPoster) {
		s.opts.Logger.Warn("poster download failed", "tmdb_id", details.TMDBID, "err", err)
	}
	d, err := s.library.Get(ctx, id, library.View{Country: region.Country, Now: s.opts.Clock()})
	if err != nil {
		return nil, err
	}
	return oapi.CreateTitle201JSONResponse(detailToAPI(d, region.Country)), nil
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
