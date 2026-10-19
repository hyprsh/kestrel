package main

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/api"
	"github.com/hyprsh/kestrel/internal/app"
	"github.com/hyprsh/kestrel/internal/store"
)

func envWith(dir string) func(string) string {
	return func(k string) string {
		if k == "KESTREL_CONFIG_DIR" {
			return dir
		}
		return ""
	}
}

func TestResetPasswordCommandResetsTheConfigDirsAdmin(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(context.Background(), store.Options{Dir: dir})
	if err != nil {
		t.Fatal(err)
	}
	// The server keeps running on the same database while the command runs.
	srv := httptest.NewServer(app.NewHandler(app.Options{Options: api.Options{Store: st}}))
	defer srv.Close()
	post := func(path, body string) int {
		req, _ := http.NewRequest("POST", srv.URL+"/api/v1"+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res.StatusCode
	}
	if c := post("/setup/account", `{"username":"admin","password":"old password"}`); c != 201 {
		t.Fatalf("setup = %d", c)
	}

	var out bytes.Buffer
	err = resetPassword(context.Background(), []string{"--password-stdin"}, strings.NewReader("a new password\n"), &out, envWith(dir))
	if err != nil {
		t.Fatalf("reset-password: %v", err)
	}
	if c := post("/auth/login", `{"username":"admin","password":"old password"}`); c != 401 {
		t.Errorf("old password = %d, want 401", c)
	}
	if c := post("/auth/login", `{"username":"admin","password":"a new password"}`); c != 204 {
		t.Errorf("new password = %d, want 204", c)
	}
}

func TestResetPasswordCommandNeedsAPasswordSource(t *testing.T) {
	env := envWith(t.TempDir())
	err := resetPassword(context.Background(), nil, strings.NewReader(""), &bytes.Buffer{}, env)
	if err == nil || !strings.Contains(err.Error(), "--password-stdin") {
		t.Errorf("err = %v, want a hint about --password-stdin", err)
	}
	err = resetPassword(context.Background(), []string{"--password-stdin"}, strings.NewReader(""), &bytes.Buffer{}, env)
	if err == nil {
		t.Error("empty stdin accepted")
	}
}

func TestResetPasswordCommandRefusesADeclaredAccount(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "kestrel.yaml")
	if err := os.WriteFile(path, []byte("account:\n  username: admin\n  password_env: PW\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	env := func(k string) string {
		return map[string]string{"KESTREL_CONFIG_DIR": dir, "KESTREL_CONFIG_FILE": path, "PW": "correct horse"}[k]
	}
	// Refused before asking for a password: no terminal and no --password-stdin.
	err := resetPassword(context.Background(), nil, strings.NewReader(""), &bytes.Buffer{}, env)
	if err == nil || !strings.Contains(err.Error(), "Config File") || !strings.Contains(err.Error(), path) {
		t.Errorf("err = %v, want a refusal naming the Config File %s", err, path)
	}
}
