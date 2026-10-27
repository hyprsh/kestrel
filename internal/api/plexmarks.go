package api

import (
	"context"

	"github.com/hyprsh/kestrel/internal/settings"
)

// LoadPlexInstance reads the name of the plugin instance plex_sign_in names,
// the Plex server marks are made on (ADR 0019); "" when it names none. It is
// the saved name whether or not Plex sign-in is on, so what Kestrel marked can
// be taken back after sign-in is switched off.
func LoadPlexInstance(ctx context.Context, s *settings.Settings) (string, error) {
	cfg, err := loadPlexSignIn(ctx, s)
	if err != nil || cfg.Instance == nil {
		return "", err
	}
	return *cfg.Instance, nil
}
