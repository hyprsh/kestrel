// Package config reads Kestrel's bootstrap environment variables. Everything
// else lives in SQLite and is set in the UI, except the sections a Config File
// declares (KESTREL_CONFIG_FILE, internal/configfile; ADR 0014).
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strconv"
	"strings"
)

// Config is the bootstrap configuration. PUID, PGID and TZ are read by the
// image entrypoint and the Go runtime, not here.
type Config struct {
	Port      int        // KESTREL_PORT
	BaseURL   string     // KESTREL_BASE_URL, normalised: "" or "/prefix"
	ConfigDir string     // KESTREL_CONFIG_DIR
	DataDir   string     // KESTREL_DATA_DIR
	LogLevel  slog.Level // KESTREL_LOG_LEVEL
	Umask     int        // UMASK, octal
	// Provider keys: they rank below the UI override and above the key embedded in the build.
	TMDBAPIKey string // KESTREL_TMDB_API_KEY
	TVDBAPIKey string // KESTREL_TVDB_API_KEY
	// APIKey is Kestrel's own full-access key when set: it replaces the one
	// generated in the UI.
	APIKey string // KESTREL_API_KEY
	// ConfigFile is the path of the Config File, which declares sections over
	// the UI; empty means none.
	ConfigFile string // KESTREL_CONFIG_FILE
}

// apiKeyFormat is the shape of a key Kestrel generates: kst_ and base32.
var apiKeyFormat = regexp.MustCompile(`^kst_[A-Z2-7]{32,}$`)

// Load reads the configuration through getenv (os.Getenv in production).
func Load(getenv func(string) string) (Config, error) {
	str := func(key, def string) string {
		if v := getenv(key); v != "" {
			return v
		}
		return def
	}
	c := Config{
		ConfigDir: str("KESTREL_CONFIG_DIR", "/config"),
		DataDir:   str("KESTREL_DATA_DIR", "/data"),

		TMDBAPIKey: strings.TrimSpace(getenv("KESTREL_TMDB_API_KEY")),
		TVDBAPIKey: strings.TrimSpace(getenv("KESTREL_TVDB_API_KEY")),
		ConfigFile: strings.TrimSpace(getenv("KESTREL_CONFIG_FILE")),
	}

	port, err := strconv.Atoi(str("KESTREL_PORT", "7676"))
	if err != nil || port < 1 || port > 65535 {
		return c, fmt.Errorf("KESTREL_PORT: %q is not a port number", getenv("KESTREL_PORT"))
	}
	c.Port = port

	if err := c.LogLevel.UnmarshalText([]byte(str("KESTREL_LOG_LEVEL", "info"))); err != nil {
		return c, fmt.Errorf("KESTREL_LOG_LEVEL: %q is not one of debug, info, warn, error", getenv("KESTREL_LOG_LEVEL"))
	}

	umask, err := strconv.ParseUint(str("UMASK", "002"), 8, 32)
	if err != nil || umask > 0o777 {
		return c, fmt.Errorf("UMASK: %q is not an octal mode", getenv("UMASK"))
	}
	c.Umask = int(umask)

	// The error leaves the value out: it is a secret and ends up in the log.
	if c.APIKey = strings.TrimSpace(getenv("KESTREL_API_KEY")); c.APIKey != "" && !apiKeyFormat.MatchString(c.APIKey) {
		c.APIKey = ""
		return c, errors.New("KESTREL_API_KEY: not a Kestrel API key, which is kst_ followed by at least 32 characters from A-Z and 2-7")
	}

	if b := strings.Trim(getenv("KESTREL_BASE_URL"), "/"); b != "" {
		c.BaseURL = "/" + b
	}
	return c, nil
}
