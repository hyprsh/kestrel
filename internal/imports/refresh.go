package imports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"
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

// RefresherChecks keeps each media server's last check: a refresh is an
// observed call, so its outcome is the server's latest check.
type RefresherChecks interface {
	Observe(ctx context.Context, instanceID int64, err error)
}

// ChangeFeed keeps the Title folder changes that settled (see FolderFeed).
type ChangeFeed interface {
	Record(ctx context.Context, folder string, exists bool) error
}

// RefresherDeps are what NewRefresher needs.
type RefresherDeps struct {
	Servers MediaServers
	// Health is optional; without it failures are only logged.
	Health RefresherHealth
	// Checks is optional; without it a refresh is not kept as a check.
	Checks RefresherChecks
	// Feed is optional; without it settled changes are only sent to the media
	// servers.
	Feed ChangeFeed
	// Delay defaults to RefreshDelay.
	Delay  time.Duration
	Logger *slog.Logger
	// Batch, InFlight, RetryBase and RetryMax default to the Refresh* constants.
	Batch, InFlight     int
	RetryBase, RetryMax time.Duration
}

// Batching and pacing of what the media servers hear.
const (
	// RefreshBatch is how many folders one Refresh call carries at most.
	RefreshBatch = 50
	// RefreshInFlight is how many Refresh calls one media server has open at once.
	RefreshInFlight = 2
	// RefreshRetryBase is the first wait after a rate_limited answer that gave no
	// retry-after hint; it doubles up to RefreshRetryMax.
	RefreshRetryBase = time.Second
	// RefreshRetryMax caps the wait between two tries.
	RefreshRetryMax = time.Minute
)

// Refresher tells the media servers a Title folder changed, once per folder per
// Delay however many changes land in it (PRD story 64). The folders that changed
// within a Delay are sent together, in batches, and a server that answers
// rate_limited is retried after its hint until it has heard every folder.
type Refresher struct {
	servers MediaServers
	hl      RefresherHealth
	checks  RefresherChecks
	feed    ChangeFeed
	delay   time.Duration
	log     *slog.Logger

	batch, inFlight int
	retryBase       time.Duration
	retryMax        time.Duration

	// ctx is what a refresh sent when its delay ends runs under; Close ends it.
	ctx    context.Context
	cancel context.CancelFunc

	mu      sync.Mutex
	pending map[string]struct{}
	order   []string
	timer   *time.Timer
	closed  bool
	sending sync.WaitGroup
}

// NewRefresher returns a Refresher.
func NewRefresher(d RefresherDeps) *Refresher {
	if d.Delay <= 0 {
		d.Delay = RefreshDelay
	}
	if d.Logger == nil {
		d.Logger = slog.Default()
	}
	if d.Batch <= 0 {
		d.Batch = RefreshBatch
	}
	if d.InFlight <= 0 {
		d.InFlight = RefreshInFlight
	}
	if d.RetryBase <= 0 {
		d.RetryBase = RefreshRetryBase
	}
	if d.RetryMax <= 0 {
		d.RetryMax = RefreshRetryMax
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &Refresher{
		servers: d.Servers, hl: d.Health, checks: d.Checks, feed: d.Feed, delay: d.Delay, log: d.Logger,
		batch: d.Batch, inFlight: d.InFlight, retryBase: d.RetryBase, retryMax: d.RetryMax,
		ctx: ctx, cancel: cancel, pending: map[string]struct{}{},
	}
}

// FolderChanged records that a Title folder changed: after an Import or Upgrade,
// a rename (new and old folder) or a deletion. It is the imports.Deps hook, so
// it never blocks and never fails the change it follows. The first change after
// a quiet spell starts the delay; every folder that changes within it is folded
// in and sent with it. Whether the servers hear Modified or Deleted is decided
// when the delay ends, by whether the folder still exists.
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
	r.pending[folder] = struct{}{}
	r.order = append(r.order, folder)
	if r.timer == nil {
		r.timer = time.AfterFunc(r.delay, func() { r.fire(r.ctx) })
	}
}

// Flush sends every pending refresh now. Kestrel's shutdown calls it, then
// Close, so a change in the last delay still reaches the media servers.
func (r *Refresher) Flush(ctx context.Context) { r.fire(ctx) }

// Close drops what is pending, ignores later changes, and cuts off a refresh
// still being sent and waits for it, so the Refresher reads and writes nothing
// once Close returns: the store can close after it.
func (r *Refresher) Close() {
	r.mu.Lock()
	r.closed = true
	if r.timer != nil {
		r.timer.Stop()
		r.timer = nil
	}
	r.pending = map[string]struct{}{}
	r.order = nil
	r.mu.Unlock()
	r.cancel()
	r.sending.Wait()
}

// take empties the pending folders, oldest change first.
func (r *Refresher) take() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.timer != nil {
		r.timer.Stop()
		r.timer = nil
	}
	if len(r.order) == 0 {
		return nil
	}
	folders := r.order
	r.order = nil
	r.pending = map[string]struct{}{}
	r.sending.Add(1)
	return folders
}

func (r *Refresher) fire(ctx context.Context) {
	folders := r.take()
	if folders == nil {
		return
	}
	defer r.sending.Done()
	changes := make([]mediaserver.Change, len(folders))
	for i, folder := range folders {
		kind := mediaserver.Modified
		if _, err := os.Stat(folder); errors.Is(err, os.ErrNotExist) {
			kind = mediaserver.Deleted
		}
		changes[i] = mediaserver.Change{Path: folder, Kind: kind}
		// The feed comes first, so it is written with no media server configured
		// and when listing them fails.
		if r.feed != nil {
			if err := r.feed.Record(ctx, folder, kind != mediaserver.Deleted); err != nil {
				r.log.Warn("folder-change feed: recording a change failed", "folder", folder, "err", err)
			}
		}
	}
	servers, err := r.servers.MediaServers(ctx)
	if err != nil {
		r.log.Warn("media-server refresh: listing the servers failed", "err", err)
		return
	}
	var wg sync.WaitGroup
	for _, s := range servers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r.tellAll(ctx, s, changes)
		}()
	}
	wg.Wait()
}

// tellAll sends the changes to one server in batches, with at most inFlight
// calls open at once.
func (r *Refresher) tellAll(ctx context.Context, s MediaServer, changes []mediaserver.Change) {
	sem := make(chan struct{}, r.inFlight)
	var wg sync.WaitGroup
	for start := 0; start < len(changes); start += r.batch {
		end := min(start+r.batch, len(changes))
		select {
		case sem <- struct{}{}:
		case <-ctx.Done():
			wg.Wait()
			return
		}
		wg.Add(1)
		go func(batch []mediaserver.Change) {
			defer wg.Done()
			defer func() { <-sem }()
			r.tell(ctx, s, batch)
		}(changes[start:end])
	}
	wg.Wait()
}

// tell sends one batch. A rate_limited answer waits (the server's hint, else a
// doubling backoff) and tries again until the server accepts or ctx ends: the
// changes are never dropped.
func (r *Refresher) tell(ctx context.Context, s MediaServer, batch []mediaserver.Change) {
	wait := r.retryBase
	var err error
	for {
		err = s.Server.Refresh(ctx, s.Conn, batch)
		var pe *plugin.Error
		if !errors.As(err, &pe) || pe.Code != plugin.CodeRateLimited || ctx.Err() != nil {
			break
		}
		d := pe.RetryAfter
		if d <= 0 {
			d = wait
			wait = min(wait*2, r.retryMax)
		}
		d = min(d, r.retryMax)
		r.log.Info("media server is rate limiting refreshes; waiting", "server", s.Name, "wait", d, "folders", len(batch))
		t := time.NewTimer(d)
		select {
		case <-t.C:
		case <-ctx.Done():
			t.Stop()
		}
		if ctx.Err() != nil {
			break
		}
	}
	r.outcome(ctx, s, batch, err)
}

func (r *Refresher) outcome(ctx context.Context, s MediaServer, batch []mediaserver.Change, err error) {
	failKey := health.RefreshFailedKey(s.InstanceID)
	if r.checks != nil && ctx.Err() == nil {
		r.checks.Observe(ctx, s.InstanceID, err)
	}
	var pe *plugin.Error
	switch {
	case err == nil:
		r.clear(ctx, failKey)
		for _, c := range batch {
			r.clear(ctx, fmt.Sprintf("%s:%s", health.KindPlexNoSection, c.Path))
		}
	case ctx.Err() != nil:
		// Shutdown cut it off; the server did nothing wrong.
		r.log.Warn("media-server refresh cut off by shutdown", "server", s.Name, "folders", len(batch))
	case errors.As(err, &pe) && pe.Code == plugin.CodeNotFound:
		// The error names the folders in no library; the rest of the batch was sent.
		named := 0
		for _, c := range batch {
			if !strings.Contains(pe.Message, c.Path) {
				continue
			}
			named++
			r.log.Warn("media-server refresh: folder is in no library", "server", s.Name, "folder", c.Path)
			r.raise(ctx, health.Issue{
				Key: fmt.Sprintf("%s:%s", health.KindPlexNoSection, c.Path), Kind: health.KindPlexNoSection, Severity: health.Warning, Dismissible: true,
				Subject: health.Subject{PluginInstanceID: s.InstanceID},
				Message: fmt.Sprintf("%s has no library that contains %s", s.Name, c.Path),
			})
		}
		if named == 0 {
			r.log.Warn("media-server refresh failed", "server", s.Name, "err", err)
			r.raise(ctx, r.failed(s, pe.Message))
		}
	default:
		r.log.Warn("media-server refresh failed", "server", s.Name, "folders", len(batch), "err", err)
		r.raise(ctx, r.failed(s, plugin.AsError(err).Message))
	}
}

func (r *Refresher) failed(s MediaServer, msg string) health.Issue {
	return health.Issue{
		Key: health.RefreshFailedKey(s.InstanceID), Kind: health.KindRefreshFailed, Severity: health.Warning, Dismissible: true,
		Subject: health.Subject{PluginInstanceID: s.InstanceID},
		Message: fmt.Sprintf("%s could not be told about a change: %s", s.Name, msg),
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
