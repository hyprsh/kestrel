package imports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"sync"
	"time"

	"github.com/hyprsh/kestrel/internal/health"
	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
	mediaserver "github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1"
)

// RefreshDelay is how long a Title folder's changes are collected before the
// media servers hear about them.
const RefreshDelay = 10 * time.Second

// MediaServer is one enabled media server instance, ready to call.
type MediaServer struct {
	InstanceID int64
	Name       string
	PluginID   string
	Server     mediaserver.Server
	Conn       plugin.Connection
}

// MediaServers lists the enabled media servers.
type MediaServers interface {
	MediaServers(ctx context.Context) ([]MediaServer, error)
}

// InstanceServers lists the enabled media_server.v1 instances of a plugin
// instance store.
func InstanceServers(inst *instances.Service) MediaServers { return instanceServers{inst} }

type instanceServers struct{ inst *instances.Service }

func (s instanceServers) MediaServers(ctx context.Context) ([]MediaServer, error) {
	enabled, err := s.inst.Enabled(ctx, mediaserver.Contract.ID)
	if err != nil {
		return nil, err
	}
	var out []MediaServer
	for _, i := range enabled {
		p, _, ok := s.inst.Registry().Lookup(i.PluginID)
		srv, isServer := p.(mediaserver.Server)
		if !ok || !isServer {
			continue
		}
		out = append(out, MediaServer{InstanceID: i.ID, Name: i.Name, PluginID: i.PluginID, Server: srv, Conn: i.Connection()})
	}
	return out, nil
}

// RefresherHealth is what the Refresher needs of the health module.
type RefresherHealth interface {
	Raise(ctx context.Context, is health.Issue) error
	Clear(ctx context.Context, key string) error
}

// RefresherDeps are what NewRefresher needs.
type RefresherDeps struct {
	Servers MediaServers
	// Health is optional; without it failures are only logged.
	Health RefresherHealth
	// Delay defaults to RefreshDelay.
	Delay  time.Duration
	Logger *slog.Logger
}

// Refresher tells the media servers a Title folder changed, once per folder per
// Delay however many changes land in it (PRD story 64).
type Refresher struct {
	servers MediaServers
	hl      RefresherHealth
	delay   time.Duration
	log     *slog.Logger

	// ctx is what a refresh sent when its delay ends runs under; Close ends it.
	ctx    context.Context
	cancel context.CancelFunc

	mu      sync.Mutex
	pending map[string]*pendingRefresh
	closed  bool
	sending sync.WaitGroup
}

type pendingRefresh struct{ timer *time.Timer }

// NewRefresher returns a Refresher.
func NewRefresher(d RefresherDeps) *Refresher {
	if d.Delay <= 0 {
		d.Delay = RefreshDelay
	}
	if d.Logger == nil {
		d.Logger = slog.Default()
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &Refresher{servers: d.Servers, hl: d.Health, delay: d.Delay, log: d.Logger, ctx: ctx, cancel: cancel, pending: map[string]*pendingRefresh{}}
}

// FolderChanged records that a Title folder changed: after an Import or Upgrade,
// a rename (new and old folder) or a deletion. It is the imports.Deps hook, so
// it never blocks and never fails the change it follows. The first change to a
// folder starts its delay; later ones within it are folded in. Whether the
// servers hear Modified or Deleted is decided when the delay ends, by whether
// the folder still exists.
func (r *Refresher) FolderChanged(_ context.Context, folder string) {
	if folder == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return
	}
	if _, ok := r.pending[folder]; ok {
		return
	}
	p := &pendingRefresh{}
	p.timer = time.AfterFunc(r.delay, func() { r.fire(r.ctx, folder) })
	r.pending[folder] = p
}

// Flush sends every pending refresh now. Kestrel's shutdown calls it, then
// Close, so a change in the last delay still reaches the media servers.
func (r *Refresher) Flush(ctx context.Context) {
	r.mu.Lock()
	folders := make([]string, 0, len(r.pending))
	for f := range r.pending {
		folders = append(folders, f)
	}
	r.mu.Unlock()
	for _, f := range folders {
		r.fire(ctx, f)
	}
}

// Close drops what is pending, ignores later changes, and cuts off a refresh
// still being sent and waits for it, so the Refresher reads and writes nothing
// once Close returns: the store can close after it.
func (r *Refresher) Close() {
	r.mu.Lock()
	r.closed = true
	for f, p := range r.pending {
		p.timer.Stop()
		delete(r.pending, f)
	}
	r.mu.Unlock()
	r.cancel()
	r.sending.Wait()
}

func (r *Refresher) fire(ctx context.Context, folder string) {
	r.mu.Lock()
	p, ok := r.pending[folder]
	if ok {
		p.timer.Stop()
		delete(r.pending, folder)
		r.sending.Add(1)
	}
	r.mu.Unlock()
	if !ok {
		return
	}
	defer r.sending.Done()
	servers, err := r.servers.MediaServers(ctx)
	if err != nil {
		r.log.Warn("media-server refresh: listing the servers failed", "err", err)
		return
	}
	kind := mediaserver.Modified
	if _, err := os.Stat(folder); errors.Is(err, os.ErrNotExist) {
		kind = mediaserver.Deleted
	}
	for _, s := range servers {
		r.tell(ctx, s, mediaserver.Change{Path: folder, Kind: kind})
	}
}

func (r *Refresher) tell(ctx context.Context, s MediaServer, c mediaserver.Change) {
	err := s.Server.Refresh(ctx, s.Conn, []mediaserver.Change{c})
	failKey := fmt.Sprintf("%s:%s", health.KindRefreshFailed, s.PluginID)
	sectionKey := fmt.Sprintf("%s:%s", health.KindPlexNoSection, c.Path)
	var pe *plugin.Error
	switch {
	case err == nil:
		r.clear(ctx, failKey)
		r.clear(ctx, sectionKey)
	case ctx.Err() != nil:
		// Shutdown cut it off; the server did nothing wrong.
		r.log.Warn("media-server refresh cut off by shutdown", "server", s.Name, "folder", c.Path)
	case errors.As(err, &pe) && pe.Code == plugin.CodeNotFound:
		r.log.Warn("media-server refresh: folder is in no library", "server", s.Name, "folder", c.Path)
		r.raise(ctx, health.Issue{
			Key: sectionKey, Kind: health.KindPlexNoSection, Severity: health.Warning, Dismissible: true,
			Subject: health.Subject{PluginInstanceID: s.InstanceID},
			Message: fmt.Sprintf("%s has no library that contains %s", s.Name, c.Path),
		})
	default:
		r.log.Warn("media-server refresh failed", "server", s.Name, "folder", c.Path, "err", err)
		r.raise(ctx, health.Issue{
			Key: failKey, Kind: health.KindRefreshFailed, Severity: health.Warning, Dismissible: true,
			Subject: health.Subject{PluginInstanceID: s.InstanceID},
			Message: fmt.Sprintf("%s could not be told about a change: %s", s.Name, plugin.AsError(err).Message),
		})
	}
}

func (r *Refresher) raise(ctx context.Context, is health.Issue) {
	if r.hl == nil {
		return
	}
	if err := r.hl.Raise(ctx, is); err != nil {
		r.log.Warn("raising a media-server warning failed", "key", is.Key, "err", err)
	}
}

func (r *Refresher) clear(ctx context.Context, key string) {
	if r.hl == nil {
		return
	}
	if err := r.hl.Clear(ctx, key); err != nil {
		r.log.Warn("clearing a media-server warning failed", "key", key, "err", err)
	}
}
