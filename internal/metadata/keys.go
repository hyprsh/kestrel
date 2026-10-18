package metadata

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/hyprsh/kestrel/internal/settings"
)

// embeddedTMDBKey and embeddedTVDBKey are the project's own provider keys. They
// are empty in source and injected at build time:
//
//	go build -ldflags "-X github.com/hyprsh/kestrel/internal/metadata.embeddedTMDBKey=..."
var (
	embeddedTMDBKey string
	embeddedTVDBKey string
)

// SettingsKey is the settings document holding the UI's key overrides:
// {"tmdb_api_key": "...", "tvdb_api_key": "..."}.
const SettingsKey = "metadata"

// KeySource yields the TMDB API key for a call.
type KeySource interface {
	TMDB(ctx context.Context) (string, error)
}

// TVDBKeySource yields the TheTVDB API key for a login.
type TVDBKeySource interface {
	TVDB(ctx context.Context) (string, error)
}

// StaticKey is a KeySource that always answers key.
type StaticKey string

// TMDB returns the key.
func (k StaticKey) TMDB(context.Context) (string, error) { return string(k), nil }

// StaticTVDBKey is a TVDBKeySource that always answers key.
type StaticTVDBKey string

// TVDB returns the key.
func (k StaticTVDBKey) TVDB(context.Context) (string, error) { return string(k), nil }

// Keys resolves the provider keys by precedence (PRD Settled 22): the UI
// override in settings.metadata, then KESTREL_TMDB_API_KEY / KESTREL_TVDB_API_KEY,
// then the embedded key. An empty value falls through to the next source.
type Keys struct {
	Settings *settings.Settings
	Env      string // KESTREL_TMDB_API_KEY
	Embedded string

	TVDBEnv      string // KESTREL_TVDB_API_KEY
	TVDBEmbedded string
}

// NewKeys returns Keys with the build's embedded keys.
func NewKeys(s *settings.Settings, tmdbEnv, tvdbEnv string) Keys {
	return Keys{Settings: s, Env: tmdbEnv, Embedded: embeddedTMDBKey, TVDBEnv: tvdbEnv, TVDBEmbedded: embeddedTVDBKey}
}

// override reads one key of the settings document; "" when unset.
func (k Keys) override(ctx context.Context, field string) (string, error) {
	if k.Settings == nil {
		return "", nil
	}
	raw, ok, err := k.Settings.Get(ctx, SettingsKey)
	if err != nil || !ok {
		return "", err
	}
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		return "", fmt.Errorf("metadata: stored %s is invalid: %w", SettingsKey, err)
	}
	v, _ := doc[field].(string)
	return v, nil
}

// OverridesSet says which provider keys the UI has overridden. The keys
// themselves are secrets and are never read back out.
type OverridesSet struct{ TMDB, TVDB bool }

// OverridesSet reports which UI overrides are set.
func (k Keys) OverridesSet(ctx context.Context) (OverridesSet, error) {
	tmdb, err := k.override(ctx, "tmdb_api_key")
	if err != nil {
		return OverridesSet{}, err
	}
	tvdb, err := k.override(ctx, "tvdb_api_key")
	return OverridesSet{TMDB: tmdb != "", TVDB: tvdb != ""}, err
}

// SetOverrides saves the UI's key overrides: nil leaves a key as it is, an
// empty string clears it so the next source in the precedence applies.
func (k Keys) SetOverrides(ctx context.Context, tmdb, tvdb *string) error {
	doc := map[string]any{}
	if raw, ok, err := k.Settings.Get(ctx, SettingsKey); err != nil {
		return err
	} else if ok {
		if err := json.Unmarshal(raw, &doc); err != nil {
			return fmt.Errorf("metadata: stored %s is invalid: %w", SettingsKey, err)
		}
	}
	if tmdb != nil {
		doc["tmdb_api_key"] = *tmdb
	}
	if tvdb != nil {
		doc["tvdb_api_key"] = *tvdb
	}
	raw, err := json.Marshal(doc)
	if err != nil {
		return err
	}
	return k.Settings.Put(ctx, SettingsKey, raw)
}

// TMDB returns the key to use, or "" when no source has one.
func (k Keys) TMDB(ctx context.Context) (string, error) {
	if v, err := k.override(ctx, "tmdb_api_key"); err != nil || v != "" {
		return v, err
	}
	if k.Env != "" {
		return k.Env, nil
	}
	return k.Embedded, nil
}

// TVDB returns the TheTVDB key to use, or "" when no source has one.
func (k Keys) TVDB(ctx context.Context) (string, error) {
	if v, err := k.override(ctx, "tvdb_api_key"); err != nil || v != "" {
		return v, err
	}
	if k.TVDBEnv != "" {
		return k.TVDBEnv, nil
	}
	return k.TVDBEmbedded, nil
}
