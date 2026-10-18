// Package mediaserver is the media_server.v1 plugin contract (ADR 0008): tell a
// media server (Silo, Jellyfin, Plex) that a Title folder changed, so new files
// show up without a full library scan. Every type is plain data and every call
// stateless; the host passes the instance's Connection each time.
//
// Changes within v1 are additive. A breaking change is a new package.
package mediaserver

import (
	"context"

	"github.com/hyprsh/kestrel/internal/plugin"
)

// Contract is how media_server.v1 registers. Any number of media servers may
// be enabled: all of them are told.
var Contract = plugin.Contract{ID: "media_server.v1"}

// Server is a media server adapter.
type Server interface {
	plugin.Plugin

	// Refresh tells the server that each Change's folder changed. The paths are
	// sent exactly as Kestrel sees them. A folder the server cannot place (a path
	// in no Plex library section) is a not_found Error that names the folder in
	// its Message; the other changes are still sent.
	Refresh(ctx context.Context, conn plugin.Connection, changes []Change) error
}

// ChangeKind says what happened to a folder.
type ChangeKind string

const (
	Created  ChangeKind = "created"
	Modified ChangeKind = "modified"
	Deleted  ChangeKind = "deleted"
)

// Change is one Title folder that changed.
type Change struct {
	Path string     `json:"path"`
	Kind ChangeKind `json:"kind"`
}
