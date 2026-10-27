package mediaserver

import (
	"context"
	"time"

	"github.com/hyprsh/kestrel/internal/plugin"
)

// PlayHistory is what a media server can add to Server when it keeps a play
// history of every account (Plex does; ADR 0019). The host finds it by asking a
// Server for this interface, so servers that cannot are left alone.
type PlayHistory interface {
	Server

	// Plays lists the episodes any account played at or after since, oldest
	// first. Reading from the zero time starts at the oldest play. A server may
	// stop short of everything it has; Plays.Through says how far the read got,
	// and the next read starts from there.
	Plays(ctx context.Context, conn plugin.Connection, since time.Time) (Plays, error)

	// ShowGuids lists the external ids the server holds for a show, as the
	// server writes them ("tvdb://81189"), by the ShowKey of a Play. A show the
	// server no longer has is a not_found Error.
	ShowGuids(ctx context.Context, conn plugin.Connection, showKey string) ([]string, error)
}

// Play is one play of an episode.
type Play struct {
	ViewedAt time.Time `json:"viewed_at"`
	// ShowKey is the server's own key for the show, for ShowGuids.
	ShowKey string `json:"show_key"`
	// Season and Episode are the episode's numbers in the server's library.
	Season  int `json:"season"`
	Episode int `json:"episode"`
}

// Plays is what a read of the history found.
type Plays struct {
	Items []Play `json:"items"`
	// Through is the time of the newest history entry read, of any kind. The
	// zero time means the history held nothing at or after the time asked.
	Through time.Time `json:"through"`
}
