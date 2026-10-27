package api

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"strings"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/requests"
	"github.com/hyprsh/kestrel/internal/settings/rootfolders"
	"github.com/hyprsh/kestrel/internal/slot"
)

// plexSource is the source of the Requests Requesters make in Kestrel's own UI.
const plexSource = "plex"

// onlyRequester is the signed-in Requester, or a 403 for every other caller.
func onlyRequester(ctx context.Context) (*requester, error) {
	if who := requestFrom(ctx).requester; who != nil {
		return who, nil
	}
	return nil, problem(http.StatusForbidden, "forbidden", "only a Requester signed in with Plex can use this")
}

func (s *server) ListMyRequests(ctx context.Context, r oapi.ListMyRequestsRequestObject) (oapi.ListMyRequestsResponseObject, error) {
	who, err := onlyRequester(ctx)
	if err != nil {
		return nil, err
	}
	// The id must match exactly: a name filter would also reach another
	// account whose name is the same ignoring case.
	f := requests.Filter{Sources: []string{plexSource}, RequesterIDs: []string{who.id}}
	page, err := s.requestPage(ctx, f, r.Params.Limit, r.Params.Cursor)
	if err != nil {
		return nil, err
	}
	return oapi.ListMyRequests200JSONResponse(page), nil
}

func (s *server) CreateMyRequest(ctx context.Context, r oapi.CreateMyRequestRequestObject) (oapi.CreateMyRequestResponseObject, error) {
	who, err := onlyRequester(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, invalid("body", "required", "a body is required")
	}
	kind := library.Kind(r.Body.Kind)
	if kind != library.Movie && kind != library.Series {
		return nil, invalid("kind", "invalid", "A Title is a movie or a series")
	}
	if r.Body.TmdbId <= 0 {
		return nil, invalid("tmdb_id", "required", "Name the Title by its tmdb_id")
	}
	root, err := s.requesterRoot(ctx, *who, kind)
	if err != nil {
		return nil, err
	}
	switches, err := LoadPlexSwitches(ctx, s.plex.settings)
	if err != nil {
		return nil, err
	}
	req, created, err := s.submitRequest(ctx, requests.Input{
		Source: plexSource, SourceRequestID: fmt.Sprintf("%s-%s-%d", who.id, kind, r.Body.TmdbId),
		RequesterID: who.id, RequesterName: who.name,
		Kind: kind, TMDBID: r.Body.TmdbId,
		Slots:      []requests.SlotInput{{Slot: slot.Standard}},
		RootFolder: root, WatchAhead: switches.WatchAhead,
	})
	if err != nil {
		return nil, err
	}
	if !created {
		return oapi.CreateMyRequest200JSONResponse(requestToAPI(req)), nil
	}
	return oapi.CreateMyRequest201JSONResponse(requestToAPI(req)), nil
}

// requesterRoot is the Root folder a Title the Requester's Request creates
// goes in: the one Plex sign-in sends this user's Requests to, matched by
// username or name ignoring case, or "" for the kind's first. A folder that
// has left the Root folders since is not used.
func (s *server) requesterRoot(ctx context.Context, who requester, kind library.Kind) (string, error) {
	cfg, err := loadPlexSignIn(ctx, s.plex.settings)
	if err != nil {
		return "", err
	}
	roots, _, err := s.rootFolders.Get(ctx)
	if err != nil {
		return "", err
	}
	for _, f := range cfg.UserRootFolders {
		if !strings.EqualFold(f.User, who.name) && !strings.EqualFold(f.User, who.title) {
			continue
		}
		pick, configured := f.Movies, roots.Movies
		if rootfolders.Kind(kind) == rootfolders.Series {
			pick, configured = f.Series, roots.Series
		}
		if pick != nil && slices.Contains(configured, *pick) {
			return *pick, nil
		}
	}
	return "", nil
}
