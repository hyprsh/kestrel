package config_test

import (
	"log/slog"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/config"
)

func env(kv ...string) func(string) string {
	m := map[string]string{}
	for i := 0; i < len(kv); i += 2 {
		m[kv[i]] = kv[i+1]
	}
	return func(k string) string { return m[k] }
}

func TestDefaults(t *testing.T) {
	c, err := config.Load(env())
	if err != nil {
		t.Fatal(err)
	}
	want := config.Config{Port: 7676, BaseURL: "", ConfigDir: "/config", DataDir: "/data", LogLevel: slog.LevelInfo, Umask: 0o002}
	if c != want {
		t.Fatalf("defaults = %+v, want %+v", c, want)
	}
}

func TestOverrides(t *testing.T) {
	c, err := config.Load(env(
		"KESTREL_PORT", "8080", "KESTREL_BASE_URL", "/kestrel", "KESTREL_CONFIG_DIR", "/c",
		"KESTREL_DATA_DIR", "/d", "KESTREL_LOG_LEVEL", "debug", "UMASK", "022"))
	if err != nil {
		t.Fatal(err)
	}
	want := config.Config{Port: 8080, BaseURL: "/kestrel", ConfigDir: "/c", DataDir: "/d", LogLevel: slog.LevelDebug, Umask: 0o022}
	if c != want {
		t.Fatalf("got %+v, want %+v", c, want)
	}
}

func TestProviderKeysComeFromTheEnvironment(t *testing.T) {
	c, err := config.Load(env("KESTREL_TMDB_API_KEY", "tmdb-secret", "KESTREL_TVDB_API_KEY", "tvdb-secret"))
	if err != nil {
		t.Fatal(err)
	}
	if c.TMDBAPIKey != "tmdb-secret" || c.TVDBAPIKey != "tvdb-secret" {
		t.Errorf("keys = %q %q", c.TMDBAPIKey, c.TVDBAPIKey)
	}
	if c, _ = config.Load(env()); c.TMDBAPIKey != "" {
		t.Errorf("unset key = %q", c.TMDBAPIKey)
	}
}

func TestBaseURLIsNormalised(t *testing.T) {
	for in, want := range map[string]string{"": "", "/": "", "kestrel": "/kestrel", "/kestrel/": "/kestrel", "/a/b": "/a/b"} {
		c, err := config.Load(env("KESTREL_BASE_URL", in))
		if err != nil || c.BaseURL != want {
			t.Errorf("base %q -> %q (err %v), want %q", in, c.BaseURL, err, want)
		}
	}
}

func TestInvalidValuesAreRejectedWithTheVariableName(t *testing.T) {
	for k, v := range map[string]string{
		"KESTREL_PORT": "http", "KESTREL_LOG_LEVEL": "loud", "UMASK": "999",
	} {
		if _, err := config.Load(env(k, v)); err == nil || !strings.Contains(err.Error(), k) {
			t.Errorf("%s=%s: err = %v, want one naming the variable", k, v, err)
		}
	}
	if _, err := config.Load(env("KESTREL_PORT", "70000")); err == nil {
		t.Error("port out of range accepted")
	}
}
