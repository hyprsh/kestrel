package api

import (
	"context"

	"github.com/hyprsh/kestrel/internal/settings"
)

// LoadWatchAhead reads whether Watch-ahead is on (the `watch_ahead` switch, on
// only while Plex sign-in is) and the name of the Plex instance `plex_sign_in`
// names, whose server's play history Watch-ahead reads.
func LoadWatchAhead(ctx context.Context, s *settings.Settings) (on bool, instance string, err error) {
	sw, err := LoadPlexSwitches(ctx, s)
	if err != nil || !sw.WatchAhead {
		return false, "", err
	}
	cfg, err := loadPlexSignIn(ctx, s)
	if err != nil || cfg.Instance == nil {
		return false, "", err
	}
	return true, *cfg.Instance, nil
}
