package app

import (
	"context"
	"log/slog"
	"time"

	"github.com/hyprsh/kestrel/internal/api"
	"github.com/hyprsh/kestrel/internal/plexmarks"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
	mediaserver "github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1"
	"github.com/hyprsh/kestrel/internal/requests"
	"github.com/hyprsh/kestrel/internal/settings"
	"github.com/hyprsh/kestrel/internal/store"
)

// newPlexMarks is the "Marks in Plex" pass, on the Plex instance that
// plex_sign_in names and with the switches it holds.
func newPlexMarks(st *store.Store, reqs *requests.Service, s *settings.Settings, inst *instances.Service, clock func() time.Time, log *slog.Logger) *plexmarks.Service {
	return plexmarks.New(plexmarks.Deps{
		Store: st, Source: reqs, Clock: clock, Logger: log,
		Switches: func(ctx context.Context) (plexmarks.Switches, error) {
			sw, err := api.LoadPlexSwitches(ctx, s)
			return plexmarks.Switches{Labels: sw.Labels, PosterBadge: sw.PosterBadge, BadgeDays: sw.PosterBadgeDays}, err
		},
		Target: func(ctx context.Context) (plexmarks.Target, bool, error) {
			name, err := api.LoadPlexInstance(ctx, s)
			if err != nil || name == "" {
				return plexmarks.Target{}, false, err
			}
			list, err := inst.List(ctx)
			if err != nil {
				return plexmarks.Target{}, false, err
			}
			for _, i := range list {
				if i.Name != name || i.PluginID != "plex" || !i.Enabled {
					continue
				}
				p, _, ok := inst.Registry().Lookup(i.PluginID)
				if m, isMarker := p.(mediaserver.Marker); ok && isMarker {
					return plexmarks.Target{InstanceID: i.ID, Server: m, Conn: i.Connection()}, true, nil
				}
			}
			return plexmarks.Target{}, false, nil
		},
	})
}
