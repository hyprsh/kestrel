// Package watchahead is Watch-ahead (ADR 0019, ADR 0020): a Series Request
// asks for season 1 only, and once anyone on the household's Plex or Silo
// server has played 2 episodes of the newest season the Request holds, the next
// season is added to that same Request.
//
// watchahead owns the plex_history_position, watch_ahead_plays and plex_shows
// tables. They keep their names from when only Plex was read; each row is keyed
// by plugin instance, so a Silo instance has its own. It reads the play history
// of every instance in Config through the media_server.v1 PlayHistory contract,
// all into the same plays by TheTVDB id, and asks the Request module to add
// seasons. Every pass decides from the Request's seasons and the plays
// stored, so a pass that missed or failed loses nothing.
package watchahead

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/hyprsh/kestrel/internal/history"
	"github.com/hyprsh/kestrel/internal/library"
	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
	mediaserver "github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1"
	"github.com/hyprsh/kestrel/internal/requests"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/watchahead/db"
)

// Watched is how many distinct episodes of the newest season must have been
// played before the next season is added.
const Watched = 2

// Config is the instances Watch-ahead reads.
type Config struct {
	// Instances are the names of the media-server plugin instances (Plex or
	// Silo) whose play history counts. None switches Watch-ahead off.
	Instances []string
}

// Requests is what Watch-ahead needs of the Request module.
type Requests interface {
	WatchAheads(ctx context.Context) ([]requests.WatchAhead, error)
	AddSeason(ctx context.Context, requestID int64, season int) (searchDue bool, err error)
}

// Library is what Watch-ahead needs of the Library.
type Library interface {
	Get(ctx context.Context, id int64, view library.View) (library.Detail, error)
}

// Instances is the plugin instances.
type Instances interface {
	List(ctx context.Context) ([]instances.Instance, error)
	Registry() *plugin.Registry
}

// Deps are the modules Watch-ahead calls.
type Deps struct {
	Store     *store.Store
	Clock     func() time.Time
	Config    func(ctx context.Context) (Config, error)
	Instances Instances
	Requests  Requests
	Library   Library
	// History records the Log's entry for a season added; optional.
	History *history.Service
	Logger  *slog.Logger
}

// Service is Watch-ahead.
type Service struct{ d Deps }

// New returns a Service.
func New(d Deps) *Service {
	if d.Clock == nil {
		d.Clock = time.Now
	}
	if d.Logger == nil {
		d.Logger = slog.Default()
	}
	return &Service{d: d}
}

func ts(t time.Time) string { return t.UTC().Format(time.RFC3339) }

// Pass is one pass of the Background job: it stores the plays since the last
// pass, then adds the next season to each Watch-ahead Request whose newest
// season has been played enough. It returns how many seasons it added; the
// caller kicks the search sweep when that is above 0. With no instances to
// read, it does nothing. An instance that cannot be read does not stop the
// others or the Requests: the first error is returned after the pass.
func (s *Service) Pass(ctx context.Context) (added int, err error) {
	cfg, err := s.d.Config(ctx)
	if err != nil || len(cfg.Instances) == 0 {
		return 0, err
	}
	asks, err := s.d.Requests.WatchAheads(ctx)
	if err != nil || len(asks) == 0 {
		return 0, err
	}
	var first error
	for _, name := range cfg.Instances {
		if err := s.readPlays(ctx, name, asks); err != nil && first == nil {
			first = fmt.Errorf("instance %q: %w", name, err)
		}
	}
	for _, ask := range asks {
		n, err := s.advance(ctx, ask)
		added += n
		if err != nil && first == nil {
			first = err
		}
	}
	return added, first
}

// server finds a media-server instance and the plugin behind it.
func (s *Service) server(ctx context.Context, name string) (instances.Instance, mediaserver.PlayHistory, error) {
	list, err := s.d.Instances.List(ctx)
	if err != nil {
		return instances.Instance{}, nil, err
	}
	for _, i := range list {
		if i.Name != name {
			continue
		}
		p, _, ok := s.d.Instances.Registry().Lookup(i.PluginID)
		if h, isHistory := p.(mediaserver.PlayHistory); ok && isHistory {
			return i, h, nil
		}
		return i, nil, fmt.Errorf("the plugin of instance %q cannot list plays", name)
	}
	return instances.Instance{}, nil, fmt.Errorf("there is no plugin instance named %q", name)
}

// readPlays stores the episodes played since the remembered point and moves
// the point on, in one write, after every show is resolved. A read that fails
// part way changes nothing, so the next pass reads the same plays again.
func (s *Service) readPlays(ctx context.Context, name string, asks []requests.WatchAhead) error {
	inst, srv, err := s.server(ctx, name)
	if err != nil {
		return err
	}
	conn := inst.Connection()
	q := db.New(s.d.Store.Read())

	// Plays from before the oldest Watch-ahead Request do not count for it, so
	// a point older than that is brought up to it, and a first read starts there.
	var since time.Time
	for _, a := range asks {
		if since.IsZero() || a.CreatedAt.Before(since) {
			since = a.CreatedAt
		}
	}
	if at, err := q.GetHistoryPosition(ctx, inst.ID); err == nil {
		if p := time.Unix(at, 0); p.After(since) {
			since = p
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return err
	}

	got, err := srv.Plays(ctx, conn, since)
	if err != nil {
		return err
	}
	type play struct{ tvdb, season, episode int }
	var plays []play
	shows := map[string]int{}
	for _, p := range got.Items {
		tvdb, ok := shows[p.ShowKey]
		if !ok {
			if tvdb, err = s.tvdbOf(ctx, inst.ID, srv, conn, p.ShowKey); err != nil {
				return err
			}
			shows[p.ShowKey] = tvdb
		}
		if tvdb != 0 {
			plays = append(plays, play{tvdb, p.Season, p.Episode})
		}
	}

	tx, err := s.d.Store.Write().BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	w := db.New(tx)
	seen := ts(s.d.Clock())
	for _, p := range plays {
		if err := w.InsertPlay(ctx, db.InsertPlayParams{TvdbID: int64(p.tvdb), Season: int64(p.season), Episode: int64(p.episode), FirstSeenAt: seen}); err != nil {
			return err
		}
	}
	if !got.Through.IsZero() {
		if err := w.SetHistoryPosition(ctx, db.SetHistoryPositionParams{InstanceID: inst.ID, ViewedAt: got.Through.Unix()}); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// tvdbOf is a Plex show's TheTVDB id, fetched once and then remembered. A show
// without one (or one Plex no longer has) is remembered as 0.
func (s *Service) tvdbOf(ctx context.Context, instanceID int64, srv mediaserver.PlayHistory, conn plugin.Connection, key string) (int, error) {
	id, err := db.New(s.d.Store.Read()).GetShow(ctx, db.GetShowParams{InstanceID: instanceID, ShowKey: key})
	if err == nil {
		return int(id), nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}
	tvdb := 0
	guids, err := srv.ShowGuids(ctx, conn, key)
	var pe *plugin.Error
	switch {
	case errors.As(err, &pe) && pe.Code == plugin.CodeNotFound:
	case err != nil:
		return 0, err
	default:
		tvdb = tvdbOfGuids(guids)
	}
	err = db.New(s.d.Store.Write()).SetShow(ctx, db.SetShowParams{InstanceID: instanceID, ShowKey: key, TvdbID: int64(tvdb), ResolvedAt: ts(s.d.Clock())})
	return tvdb, err
}

// tvdbOfGuids finds TheTVDB's id among a Plex show's guids: "tvdb://81189", or
// the legacy agent's "com.plexapp.agents.thetvdb://81189?lang=en".
func tvdbOfGuids(guids []string) int {
	for _, g := range guids {
		for _, prefix := range []string{"tvdb://", "com.plexapp.agents.thetvdb://"} {
			rest, ok := strings.CutPrefix(g, prefix)
			if !ok {
				continue
			}
			rest, _, _ = strings.Cut(rest, "?")
			rest, _, _ = strings.Cut(rest, "/")
			if n, err := strconv.Atoi(rest); err == nil && n > 0 {
				return n
			}
		}
	}
	return 0
}

// advance adds seasons to one Request for as long as its newest season has been
// played enough and TheTVDB lists a season after it. A season already played
// enough when it is added moves the Request on again in the same pass.
func (s *Service) advance(ctx context.Context, ask requests.WatchAhead) (added int, err error) {
	d, err := s.d.Library.Get(ctx, ask.TitleID, library.View{Now: s.d.Clock()})
	if errors.Is(err, library.ErrNotFound) {
		return 0, nil
	}
	if err != nil || d.TVDBID == 0 {
		return 0, err
	}
	held := slices.Clone(ask.Seasons)
	for {
		newest := 0
		for _, n := range held {
			newest = max(newest, n) // season 0, the specials, never counts
		}
		if newest == 0 {
			return added, nil
		}
		played, err := db.New(s.d.Store.Read()).CountPlayedEpisodes(ctx, db.CountPlayedEpisodesParams{TvdbID: int64(d.TVDBID), Season: int64(newest)})
		if err != nil || played < Watched {
			return added, err
		}
		next := 0
		for _, se := range d.Seasons {
			if se.Number > newest && (next == 0 || se.Number < next) {
				next = se.Number
			}
		}
		if next == 0 {
			return added, nil // TheTVDB lists no later season yet: a later pass adds it
		}
		if _, err := s.d.Requests.AddSeason(ctx, ask.RequestID, next); err != nil {
			return added, err
		}
		added++
		held = append(held, next)
		s.d.History.Record(ctx, history.Event{
			Kind: history.WatchAheadAdded, TitleID: ask.TitleID, RequestID: ask.RequestID,
			Message: fmt.Sprintf("Watch-ahead added season %d", next),
		})
	}
}
