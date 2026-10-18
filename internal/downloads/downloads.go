// Package downloads is the host of the download_client.v1 plugins (ADR 0008).
// v1 runs exactly one enabled download client; the host picks its category per
// kind of Title and hands it NZBs. It also reads the client's queue and history
// for the download poll, and removes jobs.
package downloads

import (
	"context"
	"errors"
	"sync"

	"github.com/hyprsh/kestrel/internal/plugin"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
)

// ErrNoClient means no download client is enabled.
var ErrNoClient = errors.New("no download client is enabled")

// Media says which category a job goes to.
type Media string

const (
	Movie  Media = "movie"
	Series Media = "series"
)

// Job is an NZB to download.
type Job struct {
	Media Media
	// Name is the release's name, which labels the job in the client.
	Name string
	NZB  []byte
}

// Sent says where a job went: the Grab keeps these to join on.
type Sent struct {
	InstanceID int64
	// ClientID is the client's own id for the job (SABnzbd's nzo_id).
	ClientID string
	Category string
}

// Service sends jobs to the enabled download client.
type Service struct {
	inst *instances.Service

	mu       sync.Mutex
	observer Observer
}

// Observer hears how each call to the download client went (err nil: it
// worked), with the instance it went to. Health uses it to tell when the
// client is down.
type Observer func(ctx context.Context, instanceID int64, name string, err error)

// SetObserver sets the Observer; nil stops observing.
func (s *Service) SetObserver(o Observer) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.observer = o
}

func (s *Service) observe(ctx context.Context, inst instances.Instance, err error) {
	s.mu.Lock()
	o := s.observer
	s.mu.Unlock()
	if o != nil {
		o(ctx, inst.ID, inst.Name, err)
	}
}

// Ping tests the enabled client's connection and reports it to the Observer.
// With no client enabled it reports nothing and says so.
func (s *Service) Ping(ctx context.Context) (enabled bool, err error) {
	inst, client, err := s.enabled(ctx)
	if errors.Is(err, ErrNoClient) {
		return false, nil
	}
	if err != nil {
		return true, err
	}
	_, err = client.Test(ctx, inst.Connection())
	s.observe(ctx, inst, err)
	return true, err
}

// New returns a Service over the plugin instances.
func New(inst *instances.Service) *Service { return &Service{inst: inst} }

// priorityDefault is SABnzbd's "default" priority; Kestrel never sets another.
const priorityDefault = -100

func (s *Service) client(inst instances.Instance) (downloadclient.Client, error) {
	p, _, ok := s.inst.Registry().Lookup(inst.PluginID)
	client, isClient := p.(downloadclient.Client)
	if !ok || !isClient {
		return nil, ErrNoClient
	}
	return client, nil
}

func (s *Service) enabled(ctx context.Context) (instances.Instance, downloadclient.Client, error) {
	enabled, err := s.inst.Enabled(ctx, downloadclient.Contract.ID)
	if err != nil {
		return instances.Instance{}, nil, err
	}
	if len(enabled) == 0 {
		return instances.Instance{}, nil, ErrNoClient
	}
	c, err := s.client(enabled[0])
	return enabled[0], c, err
}

func categoryOf(conn plugin.Connection, m Media) string {
	key, fallback := "movie_category", "movies"
	if m == Series {
		key, fallback = "tv_category", "tv"
	}
	if c := conn.String(key); c != "" {
		return c
	}
	return fallback
}

// Add hands the job to the enabled client, in its Movie or Series category
// (the manifest's movie_category and tv_category, "movies" and "tv" unless set).
func (s *Service) Add(ctx context.Context, job Job) (Sent, error) {
	inst, client, err := s.enabled(ctx)
	if err != nil {
		return Sent{}, err
	}
	category := categoryOf(inst.Connection(), job.Media)
	id, err := client.Add(ctx, inst.Connection(), downloadclient.AddRequest{
		Kind: downloadclient.PayloadNZB, Data: job.NZB, Filename: job.Name, Category: category, Priority: priorityDefault,
	})
	if err != nil {
		return Sent{}, err
	}
	return Sent{InstanceID: inst.ID, ClientID: id, Category: category}, nil
}

// Listed is a job in the client and the instance that holds it.
type Listed struct {
	InstanceID int64
	Item       downloadclient.Item
}

// List reads the enabled client's jobs, queue and history together, in the
// Movie and Series categories Kestrel uses. With no client enabled it is empty.
func (s *Service) List(ctx context.Context) ([]Listed, error) {
	inst, client, err := s.enabled(ctx)
	if errors.Is(err, ErrNoClient) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	conn := inst.Connection()
	var out []Listed
	seen := map[string]bool{}
	for _, m := range []Media{Movie, Series} {
		cat := categoryOf(conn, m)
		if seen[cat] {
			continue
		}
		seen[cat] = true
		items, err := client.List(ctx, conn, cat)
		if err != nil {
			s.observe(ctx, inst, err)
			return nil, err
		}
		for _, it := range items {
			out = append(out, Listed{InstanceID: inst.ID, Item: it})
		}
	}
	s.observe(ctx, inst, nil)
	return out, nil
}

// Remove deletes a job from the client instance that holds it, with its files
// when deleteData is set. A job that is already gone is not an error.
func (s *Service) Remove(ctx context.Context, instanceID int64, clientID string, deleteData bool) error {
	inst, err := s.inst.Get(ctx, instanceID)
	if err != nil {
		return err
	}
	client, err := s.client(inst)
	if err != nil {
		return err
	}
	return client.Remove(ctx, inst.Connection(), clientID, deleteData)
}
