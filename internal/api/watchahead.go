package api

import (
	"context"
	"slices"

	"github.com/hyprsh/kestrel/internal/settings"
)

// LoadWatchAhead reads the names of the instances whose play history
// Watch-ahead reads: the Plex instance `plex_sign_in` names while it and its
// `watch_ahead` switch are on, and the Silo instance the `silo` settings name.
// Watch-ahead is off while there are none (ADR 0020).
func LoadWatchAhead(ctx context.Context, s *settings.Settings) (instances []string, err error) {
	sw, err := LoadPlexSwitches(ctx, s)
	if err != nil {
		return nil, err
	}
	if sw.WatchAhead {
		cfg, err := loadPlexSignIn(ctx, s)
		if err != nil {
			return nil, err
		}
		if cfg.Instance != nil {
			instances = append(instances, *cfg.Instance)
		}
	}
	silo, err := loadSilo(ctx, s)
	if err != nil {
		return nil, err
	}
	if silo.Instance != nil && !slices.Contains(instances, *silo.Instance) {
		instances = append(instances, *silo.Instance)
	}
	return instances, nil
}
