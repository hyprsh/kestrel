package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"go.yaml.in/yaml/v3"

	"github.com/hyprsh/kestrel/internal/api"
	"github.com/hyprsh/kestrel/internal/app"
	"github.com/hyprsh/kestrel/internal/configfile"
	"github.com/hyprsh/kestrel/internal/store"
)

// readmeBlocks returns the README's fenced blocks whose info string is info,
// in order.
func readmeBlocks(t *testing.T, info string) []string {
	t.Helper()
	raw, err := os.ReadFile("../../README.md")
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	var cur *strings.Builder
	for line := range strings.Lines(string(raw)) {
		switch {
		case cur == nil && strings.TrimRight(line, "\n") == "```"+info:
			cur = &strings.Builder{}
		case cur != nil && strings.HasPrefix(line, "```"):
			out = append(out, cur.String())
			cur = nil
		case cur != nil:
			cur.WriteString(line)
		}
	}
	return out
}

// readmeConfigFile is the README's example Config File, fenced as yaml kestrel.yaml.
func readmeConfigFile(t *testing.T) string {
	t.Helper()
	blocks := readmeBlocks(t, "yaml kestrel.yaml")
	if len(blocks) != 1 {
		t.Fatalf("README has %d example Config Files (```yaml kestrel.yaml), want 1", len(blocks))
	}
	return blocks[0]
}

// envNames are the environment variables the example's <field>_env keys name.
func envNames(example string) []string {
	var out []string
	for _, m := range regexp.MustCompile(`(?m)^\s*\w+_env:\s*(\w+)`).FindAllStringSubmatch(example, -1) {
		out = append(out, m[1])
	}
	return out
}

// The README's example Config File starts a fresh Kestrel through the real
// startup path: the built-in plugins' manifests, the modules' rules and the
// store. Its Root folders live under /data, which the test moves into a temp
// dir, since they must exist. Its plugin instances point at hosts that don't
// exist here, which startup only logs.
func TestTheReadmesExampleConfigFileStartsAFreshKestrel(t *testing.T) {
	example := readmeConfigFile(t)
	data := t.TempDir()
	body := strings.ReplaceAll(example, "/data/", data+"/data/")
	path := filepath.Join(t.TempDir(), "kestrel.yaml")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	vars := map[string]string{}
	for _, name := range envNames(example) {
		vars[name] = "secret-" + name
	}
	f, err := configfile.Load(path, func(k string) string { return vars[k] })
	if err != nil {
		t.Fatal(err)
	}
	if f.Account == nil || f.LanguageRegion == nil || f.RootFolders == nil || f.Profiles == nil ||
		f.PluginInstances == nil || f.ReverseProxy == nil || f.CheckGitHubUpdates == nil {
		t.Fatalf("the example leaves a section out: %+v", f)
	}
	for _, dir := range slices.Concat(f.RootFolders.Movies, f.RootFolders.Series) {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}

	st, err := store.Open(context.Background(), store.Options{Dir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	plugins, err := builtinPlugins()
	if err != nil {
		t.Fatal(err)
	}
	kestrel := app.New(app.Options{
		Options: api.Options{Store: st, ConfigFile: f, CheapPasswordHash: true, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))},
		Plugins: plugins,
	})
	if err := kestrel.EnforceConfigFile(context.Background()); err != nil {
		t.Fatalf("the README's example fails startup: %v", err)
	}

	// The declared account logs in, and setup has nothing left to do.
	srv := httptest.NewServer(kestrel.Handler)
	defer srv.Close()
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	login, _ := json.Marshal(map[string]string{"username": f.Account.Username, "password": vars[f.Account.PasswordEnv]})
	req, _ := http.NewRequest("POST", srv.URL+"/api/v1/auth/login", bytes.NewReader(login))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", srv.URL)
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("login with the declared account = %d", res.StatusCode)
	}
	res, err = client.Get(srv.URL + "/api/v1/setup")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var setup struct{ Completed bool }
	if err := json.NewDecoder(res.Body).Decode(&setup); err != nil {
		t.Fatal(err)
	}
	if !setup.Completed {
		t.Error("the README's example leaves setup to do")
	}
}

// The README's compose snippet for the Config File mounts the example where
// KESTREL_CONFIG_FILE points, and passes every variable the example names.
func TestTheReadmesComposeSnippetPassesTheExamplesVariables(t *testing.T) {
	var snippet string
	for _, b := range readmeBlocks(t, "yaml") {
		if strings.Contains(b, "KESTREL_CONFIG_FILE") {
			snippet = b
		}
	}
	if snippet == "" {
		t.Fatal("README has no ```yaml block setting KESTREL_CONFIG_FILE")
	}
	var compose struct {
		Services map[string]struct {
			Environment []string `yaml:"environment"`
			Volumes     []string `yaml:"volumes"`
		} `yaml:"services"`
	}
	if err := yaml.Unmarshal([]byte(snippet), &compose); err != nil {
		t.Fatal(err)
	}
	svc, ok := compose.Services["kestrel"]
	if !ok {
		t.Fatalf("the snippet has no kestrel service: %s", snippet)
	}
	env := map[string]string{}
	for _, e := range svc.Environment {
		k, v, _ := strings.Cut(e, "=")
		env[k] = v
	}
	file := env["KESTREL_CONFIG_FILE"]
	mounted := slices.ContainsFunc(svc.Volumes, func(v string) bool {
		parts := strings.Split(v, ":")
		return len(parts) >= 2 && parts[1] == file
	})
	if file == "" || !mounted {
		t.Errorf("KESTREL_CONFIG_FILE=%q is not a mounted file: volumes %v", file, svc.Volumes)
	}
	for _, name := range envNames(readmeConfigFile(t)) {
		if _, ok := env[name]; !ok {
			t.Errorf("the snippet does not pass %s, which the example names", name)
		}
	}
}
