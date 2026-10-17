// Package downloadclient is the download_client.v1 plugin contract (ADR 0008):
// hand a release to a download client, read its queue and history, and remove a
// job. Every type is plain data and every call stateless; the host passes the
// instance's Connection each time.
//
// Changes within v1 are additive (new fields with usable zero values). A
// breaking change is a new package, download_client.v2.
package downloadclient

import (
	"context"
	"time"

	"github.com/hyprsh/kestrel/internal/plugin"
)

// Contract is how download_client.v1 registers. v1 runs exactly one enabled
// instance (PRD Settled 13).
var Contract = plugin.Contract{ID: "download_client.v1", MaxEnabled: 1}

// Client is a download client adapter.
type Client interface {
	plugin.Plugin

	// Add hands a release to the client and returns the client's own id for the
	// job, which the host stores on the Grab and joins on. An empty or malformed
	// payload is an invalid Error.
	Add(ctx context.Context, conn plugin.Connection, req AddRequest) (clientID string, err error)

	// List returns the client's jobs, queue and finished history together,
	// restricted to category when it is not empty.
	List(ctx context.Context, conn plugin.Connection, category string) ([]Item, error)

	// Remove deletes the job, and its downloaded files when deleteData is set.
	// Removing a job that is already gone is not an error.
	Remove(ctx context.Context, conn plugin.Connection, clientID string, deleteData bool) error
}

// PayloadKind says what AddRequest.Data holds.
type PayloadKind string

const (
	PayloadNZB     PayloadKind = "nzb"     // the NZB file's bytes
	PayloadTorrent PayloadKind = "torrent" // the .torrent file's bytes
	PayloadMagnet  PayloadKind = "magnet"  // a magnet URI as text
)

// AddRequest is one release to download.
type AddRequest struct {
	Kind PayloadKind `json:"kind"`
	Data []byte      `json:"data"`
	// Filename is the release's name, used to label the job (no path).
	Filename string `json:"filename"`
	// Category is the client-side category the job lands in.
	Category string `json:"category"`
	// Priority is a hint on the client's own scale; an adapter may ignore it.
	Priority int `json:"priority"`
}

// Phase is where a job stands.
type Phase string

const (
	PhaseQueued         Phase = "queued"
	PhaseDownloading    Phase = "downloading"
	PhasePaused         Phase = "paused"
	PhasePostProcessing Phase = "post_processing" // verifying, repairing, unpacking, moving
	PhaseCompleted      Phase = "completed"
	PhaseFailed         Phase = "failed"
)

// Failure classifies a failed job. It is empty unless Phase is failed.
type Failure string

const (
	// FailureFailed is a bad release: the host Blocklists it and tries the next best.
	FailureFailed Failure = "failed"
	// FailureEncrypted is a password-protected release: treated like failed.
	FailureEncrypted Failure = "encrypted"
	// FailureOther is a fault in the client's environment (disk full, write error), not the
	// release: the host does not Blocklist it.
	FailureOther Failure = "other"
)

// Item is one job in the client, queued, running or finished.
type Item struct {
	ClientID string  `json:"client_id"`
	Name     string  `json:"name"`
	Category string  `json:"category"`
	Phase    Phase   `json:"phase"`
	Failure  Failure `json:"failure"`
	// BytesTotal and BytesLeft are 0 when the client does not say.
	BytesTotal int64 `json:"bytes_total"`
	BytesLeft  int64 `json:"bytes_left"`
	// ETA is 0 when unknown.
	ETA time.Duration `json:"eta"`
	// OutputPath is where the finished files are, set when Phase is completed.
	OutputPath string `json:"output_path"`
	// Seeding is true while a torrent keeps uploading after completion.
	Seeding bool `json:"seeding"`
	// CanRemove says the host may Import by moving files and then call Remove;
	// while false (a seeding torrent) it hardlinks instead.
	CanRemove bool `json:"can_remove"`
	// Message is the client's own words, verbatim (a failure reason).
	Message string `json:"message"`
}
