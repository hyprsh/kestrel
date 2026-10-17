// Package config reads Kestrel's bootstrap environment variables. Everything
// else lives in SQLite and is set in the UI.
package config

import (
	"fmt"
	"log/slog"
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
}

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

	if b := strings.Trim(getenv("KESTREL_BASE_URL"), "/"); b != "" {
		c.BaseURL = "/" + b
	}
	return c, nil
}
