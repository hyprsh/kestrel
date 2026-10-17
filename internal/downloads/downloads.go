// Package downloads is the host of the download_client.v1 plugins (ADR 0008).
// v1 runs exactly one enabled download client; the host picks its category per
// kind of Title and hands it NZBs. Reading the client's queue and history
// (the poll loop) lands with the tickets that track downloads.
package downloads

import (
	"context"
	"errors"

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
}

// New returns a Service over the plugin instances.
func New(inst *instances.Service) *Service { return &Service{inst: inst} }

// priorityDefault is SABnzbd's "default" priority; Kestrel never sets another.
const priorityDefault = -100

// Add hands the job to the enabled client, in its Movie or Series category
// (the manifest's movie_category and tv_category, "movies" and "tv" unless set).
func (s *Service) Add(ctx context.Context, job Job) (Sent, error) {
	enabled, err := s.inst.Enabled(ctx, downloadclient.Contract.ID)
	if err != nil {
		return Sent{}, err
	}
	if len(enabled) == 0 {
		return Sent{}, ErrNoClient
	}
	inst := enabled[0]
	p, _, ok := s.inst.Registry().Lookup(inst.PluginID)
	client, isClient := p.(downloadclient.Client)
	if !ok || !isClient {
		return Sent{}, ErrNoClient
	}
	conn := inst.Connection()
	category := conn.String("movie_category")
	fallback := "movies"
	if job.Media == Series {
		category, fallback = conn.String("tv_category"), "tv"
	}
	if category == "" {
		category = fallback
	}
	id, err := client.Add(ctx, conn, downloadclient.AddRequest{
		Kind: downloadclient.PayloadNZB, Data: job.NZB, Filename: job.Name, Category: category, Priority: priorityDefault,
	})
	if err != nil {
		return Sent{}, err
	}
	return Sent{InstanceID: inst.ID, ClientID: id, Category: category}, nil
}
