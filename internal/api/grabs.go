package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/hyprsh/kestrel/internal/acquire"
	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/downloads"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/scoring"
)

// defaultSearchTimeout bounds a manual search: the answer is synchronous, and
// an indexer that is too slow is reported rather than waited for.
const defaultSearchTimeout = 30 * time.Second

var rejectionMessages = map[scoring.Rejection]string{
	scoring.RejectBelowMinScore:           "Score is below the Profile's minimum",
	scoring.RejectResolution:              "Resolution is outside what the Profile accepts",
	scoring.RejectQuality:                 "Quality is not one the Profile allows",
	scoring.RejectLanguage:                "Not in the language the Profile requires",
	scoring.RejectOriginalLanguageUnknown: "The Title's original language is not known",
	scoring.RejectBlocklisted:             "On the Blocklist",
	acquire.RejectOtherSlot:               "Fits another Slot",
}

func rejectionMessage(r scoring.Rejection) string {
	if m, ok := rejectionMessages[r]; ok {
		return m
	}
	return string(r)
}

func (s *server) searchTimeout() time.Duration {
	if s.opts.SearchTimeout > 0 {
		return s.opts.SearchTimeout
	}
	return defaultSearchTimeout
}

func (s *server) SearchVersionReleases(ctx context.Context, r oapi.SearchVersionReleasesRequestObject) (oapi.SearchVersionReleasesResponseObject, error) {
	ctx, cancel := context.WithTimeout(ctx, s.searchTimeout())
	defer cancel()
	res, err := s.acquire.Search(ctx, r.Id)
	switch {
	case errors.Is(err, library.ErrNotFound):
		return nil, problem(http.StatusNotFound, "not_found", "no such Version")
	case errors.Is(err, acquire.ErrUnsupportedKind):
		return nil, invalid("id", "unsupported", "Only Movies can be searched so far")
	case err != nil:
		return nil, err
	}
	out := oapi.ReleaseList{Items: make([]oapi.Release, 0, len(res.Items)), IndexerErrors: make([]oapi.IndexerError, 0, len(res.Failures))}
	for _, f := range res.Items {
		rel := oapi.Release{
			ReleaseId: f.ID, Name: f.Name, Indexer: f.Indexer, Size: f.Size, PublishedAt: f.PublishedAt, Quality: f.Quality,
			Languages: append([]string{}, f.Languages...), Score: f.Score, Fits: oapi.ReleaseFits(f.Fits),
			CustomFormats: make([]oapi.CustomFormatMatch, 0, len(f.Formats)), Rejections: make([]oapi.Rejection, 0, len(f.Rejections)),
		}
		for _, cf := range f.Formats {
			rel.CustomFormats = append(rel.CustomFormats, oapi.CustomFormatMatch{Name: cf.Name, Points: cf.Score})
		}
		for _, rj := range f.Rejections {
			rel.Rejections = append(rel.Rejections, oapi.Rejection{Code: oapi.RejectionCode(rj.Code), Message: rejectionMessage(rj.Code), Overridable: rj.Overridable})
		}
		out.Items = append(out.Items, rel)
	}
	for _, f := range res.Failures {
		e := oapi.IndexerError{Indexer: f.IndexerName, Code: string(f.Code), Message: f.Message}
		if f.IndexerID != 0 {
			id := f.IndexerID
			e.IndexerId = &id
		}
		if f.RetryAfter > 0 {
			secs := int((f.RetryAfter + time.Second - 1) / time.Second)
			e.RetryAfter = &secs
		}
		out.IndexerErrors = append(out.IndexerErrors, e)
	}
	return oapi.SearchVersionReleases200JSONResponse(out), nil
}

func grabToAPI(g acquire.Grab) oapi.Grab {
	out := oapi.Grab{
		Id: g.ID, ReleaseName: g.ReleaseName, Indexer: g.IndexerName, Size: g.Size, PublishedAt: g.PublishedAt, Score: g.Score,
		ClientId: g.ClientID, State: oapi.GrabState(g.State), Overridden: g.Overridden, IsUpgrade: g.IsUpgrade, CreatedAt: g.CreatedAt,
	}
	if g.TitleID != 0 {
		out.TitleId = &g.TitleID
	}
	if g.VersionID != 0 {
		out.VersionId = &g.VersionID
	}
	return out
}

// grabProblem maps what a Grab can fail with to the API's problems.
func grabProblem(err error) error {
	var rej *acquire.RejectedError
	var pe *plugin.Error
	switch {
	case errors.Is(err, library.ErrNotFound):
		return problem(http.StatusNotFound, "not_found", "no such Version")
	case errors.Is(err, acquire.ErrReleaseExpired):
		return problem(http.StatusConflict, "release_expired", "That Release is no longer in the search results; search again")
	case errors.Is(err, acquire.ErrReleaseGone):
		return problem(http.StatusConflict, "release_expired", "The indexer no longer has that Release; search again")
	case errors.Is(err, acquire.ErrUnsupportedKind):
		return invalid("version_id", "unsupported", "Only Movies can be grabbed so far")
	case errors.Is(err, downloads.ErrNoClient):
		return problem(http.StatusBadGateway, "upstream_unavailable", "No download client is enabled; add one in Settings")
	case errors.As(err, &rej):
		if rej.NotOverridable() {
			return problem(http.StatusUnprocessableEntity, "not_overridable", "That Release is on the Blocklist or fits another Slot, so it cannot be grabbed")
		}
		return problem(http.StatusUnprocessableEntity, "rejected", "That Release is rejected; Grab anyway to override")
	case errors.As(err, &pe):
		if pe.Code == plugin.CodeRateLimited {
			p := problem(http.StatusTooManyRequests, "rate_limited", "The indexer's grab limit is used up: "+pe.Message)
			p.retryAfter = pe.RetryAfter
			return p
		}
		return problem(http.StatusBadGateway, "upstream_unavailable", "The indexer or download client failed: "+pe.Message)
	}
	return err
}

func (s *server) CreateGrab(ctx context.Context, r oapi.CreateGrabRequestObject) (oapi.CreateGrabResponseObject, error) {
	if r.Body == nil {
		return nil, invalid("body", "required", "a body is required")
	}
	override := r.Body.Override != nil && *r.Body.Override
	g, err := s.acquire.Grab(ctx, r.Body.VersionId, r.Body.ReleaseId, override)
	if err != nil {
		return nil, grabProblem(err)
	}
	return oapi.CreateGrab201JSONResponse(grabToAPI(g)), nil
}

func (s *server) GetGrab(ctx context.Context, r oapi.GetGrabRequestObject) (oapi.GetGrabResponseObject, error) {
	g, err := s.acquire.GetGrab(ctx, r.Id)
	if errors.Is(err, acquire.ErrGrabNotFound) {
		return nil, problem(http.StatusNotFound, "not_found", "no such Grab")
	}
	if err != nil {
		return nil, err
	}
	return oapi.GetGrab200JSONResponse(grabToAPI(g)), nil
}
