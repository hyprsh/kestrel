package api

import (
	"context"
	"log/slog"
	"time"

	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/plextv"
	"github.com/hyprsh/kestrel/internal/settings"
	"github.com/hyprsh/kestrel/internal/watchlist"
)

// watchlistSource is the source of the Requests Watchlist sync makes (ADR 0019).
const watchlistSource = watchlist.Source

// watchlistHost is what Watchlist sync needs of the rest of Kestrel: whether it
// is switched on, and the way to make a Request that follows the same rules as
// a Requester's own.
type watchlistHost struct{ s *server }

// NewWatchlistHost returns the host of Watchlist sync, over the same modules as New.
func NewWatchlistHost(opts Options, d Deps) watchlist.Host {
	if opts.Logger == nil {
		opts.Logger = slog.Default()
	}
	if opts.Clock == nil {
		opts.Clock = time.Now
	}
	cfg := settings.New(opts.Store)
	s := &server{
		opts: opts, plugins: d.Plugins, rootFolders: d.RootFolders, requests: d.Requests, jobs: d.Jobs, history: d.History,
		plex: &plexSignIn{settings: cfg, plugins: d.Plugins, tv: d.PlexTV, clock: opts.Clock, log: opts.Logger},
	}
	return watchlistHost{s}
}

func (h watchlistHost) Config(ctx context.Context) (watchlist.Config, bool, error) {
	sw, err := LoadPlexSwitches(ctx, h.s.plex.settings)
	if err != nil || !sw.Watchlist {
		return watchlist.Config{}, false, err
	}
	cfg, inst, ok, err := h.s.plex.active(ctx)
	if err != nil || !ok {
		return watchlist.Config{}, false, err
	}
	plexURL, token := ownerOf(inst)
	if plexURL == "" || token == "" {
		return watchlist.Config{}, false, errNoOwnerToken
	}
	cid, err := h.s.plex.clientID(ctx)
	if err != nil {
		return watchlist.Config{}, false, err
	}
	return watchlist.Config{ClientID: cid, PlexURL: plexURL, OwnerToken: token, Users: cfg.Users}, true, nil
}

func (h watchlistHost) Request(ctx context.Context, p watchlist.Person, e watchlist.Entry) (int64, error) {
	kind := library.Movie
	if e.Kind == plextv.Series {
		kind = library.Series
	}
	who := requester{id: p.ID, name: p.Name, title: p.Title}
	req, _, err := h.s.submitRequesterRequest(ctx, who, watchlistSource, watchlist.SourceRequestID(p, e), kind, e.Ids.TMDB, e.Ids.TVDB)
	if err != nil {
		return 0, err
	}
	return req.ID, nil
}
