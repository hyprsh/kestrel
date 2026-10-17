package metadata

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/hyprsh/kestrel/internal/settings"
)

// embeddedTMDBKey is the project's own TMDB key. It is empty in source and
// injected at build time:
//
//	go build -ldflags "-X github.com/hyprsh/kestrel/internal/metadata.embeddedTMDBKey=..."
var embeddedTMDBKey string

// SettingsKey is the settings document holding the UI's key overrides:
// {"tmdb_api_key": "..."}.
const SettingsKey = "metadata"

// KeySource yields the TMDB API key for a call.
type KeySource interface {
	TMDB(ctx context.Context) (string, error)
}

// StaticKey is a KeySource that always answers key.
type StaticKey string

// TMDB returns the key.
func (k StaticKey) TMDB(context.Context) (string, error) { return string(k), nil }

// Keys resolves the TMDB key by precedence (PRD Settled 22): the UI override in
// settings.metadata, then KESTREL_TMDB_API_KEY, then the embedded key. An empty
// value falls through to the next source.
type Keys struct {
	Settings *settings.Settings
	Env      string // KESTREL_TMDB_API_KEY
	Embedded string
}

// NewKeys returns Keys with the build's embedded key.
func NewKeys(s *settings.Settings, env string) Keys {
	return Keys{Settings: s, Env: env, Embedded: embeddedTMDBKey}
}

// TMDB returns the key to use, or "" when no source has one.
func (k Keys) TMDB(ctx context.Context) (string, error) {
	if k.Settings != nil {
		raw, ok, err := k.Settings.Get(ctx, SettingsKey)
		if err != nil {
			return "", err
		}
		if ok {
			var doc struct {
				TMDBAPIKey string `json:"tmdb_api_key"`
			}
			if err := json.Unmarshal(raw, &doc); err != nil {
				return "", fmt.Errorf("metadata: stored %s is invalid: %w", SettingsKey, err)
			}
			if doc.TMDBAPIKey != "" {
				return doc.TMDBAPIKey, nil
			}
		}
	}
	if k.Env != "" {
		return k.Env, nil
	}
	return k.Embedded, nil
}
