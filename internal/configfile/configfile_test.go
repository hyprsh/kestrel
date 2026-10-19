package configfile_test

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/configfile"
)

func env(kv ...string) func(string) string {
	m := map[string]string{}
	for i := 0; i < len(kv); i += 2 {
		m[kv[i]] = kv[i+1]
	}
	return func(k string) string { return m[k] }
}

// write puts body in a file of its own and returns the path.
func write(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "kestrel.yaml")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func ptr[T any](v T) *T { return &v }

func TestLoadReadsEverySectionAndResolvesThePassword(t *testing.T) {
	path := write(t, `
account:
  username: admin
  password_env: KESTREL_ADMIN_PASSWORD
language_region:
  primary_language: de
  release_date_country: AT
root_folders:
  movies: [/data/movies, /data/movies-4k]
  series: [/data/tv]
reverse_proxy:
  enabled: true
  trusted_proxies: [10.0.0.0/8]
  header: X-Remote-User
check_github_updates: false
`)
	f, err := configfile.Load(path, env("KESTREL_ADMIN_PASSWORD", "correct horse"))
	if err != nil {
		t.Fatal(err)
	}
	if f.Path != path {
		t.Errorf("path = %q", f.Path)
	}
	if f.Account == nil || f.Account.Username != "admin" || f.Account.Password != "correct horse" {
		t.Errorf("account = %+v", f.Account)
	}
	if f.LanguageRegion == nil || f.LanguageRegion.PrimaryLanguage != "de" || f.LanguageRegion.ReleaseDateCountry != "AT" {
		t.Errorf("language_region = %+v", f.LanguageRegion)
	}
	wantRoots := &configfile.RootFolders{Movies: []string{"/data/movies", "/data/movies-4k"}, Series: []string{"/data/tv"}}
	if !reflect.DeepEqual(f.RootFolders, wantRoots) {
		t.Errorf("root_folders = %+v", f.RootFolders)
	}
	wantProxy := &configfile.ReverseProxy{Enabled: ptr(true), TrustedProxies: []string{"10.0.0.0/8"}, Header: "X-Remote-User"}
	if !reflect.DeepEqual(f.ReverseProxy, wantProxy) {
		t.Errorf("reverse_proxy = %+v", f.ReverseProxy)
	}
	if f.CheckGitHubUpdates == nil || *f.CheckGitHubUpdates {
		t.Errorf("check_github_updates = %v", f.CheckGitHubUpdates)
	}
}

func TestEverySectionIsOptional(t *testing.T) {
	for _, body := range []string{"", "# nothing declared\n", "{}\n"} {
		f, err := configfile.Load(write(t, body), env())
		if err != nil {
			t.Fatalf("%q: %v", body, err)
		}
		if f.Account != nil || f.LanguageRegion != nil || f.RootFolders != nil || f.Profiles != nil ||
			f.PluginInstances != nil || f.ReverseProxy != nil || f.CheckGitHubUpdates != nil {
			t.Errorf("%q declares %+v", body, f)
		}
	}
}

func TestAnUnknownKeyIsNamedWithItsLine(t *testing.T) {
	for _, c := range []struct{ body, want string }{
		{"acount:\n  username: admin\n", "line 1: unknown key acount"},
		{"account:\n  username: admin\n  password: hunter2-secret\n", "line 3: unknown key account.password"},
		{"root_folders:\n  movies: [/m]\n  series: [/s]\n  anime: [/a]\n", "line 4: unknown key root_folders.anime"},
		{"profiles:\n  hd-primary:\n    enabled: true\n    default: true\n", "line 4: unknown key profiles.hd-primary.default"},
		{"plugin_instances:\n  - name: SABnzbd\n    plugin: sabnzbd\n", "line 3: unknown key plugin_instances[0].plugin"},
	} {
		_, err := configfile.Load(write(t, c.body), env())
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%q: err = %v, want one with %q", c.body, err, c.want)
			continue
		}
		if strings.Contains(err.Error(), "hunter2-secret") {
			t.Errorf("the error repeats a value: %v", err)
		}
	}
}

func TestTheErrorNamesTheFile(t *testing.T) {
	path := write(t, "acount: {}\n")
	_, err := configfile.Load(path, env())
	if err == nil || !strings.Contains(err.Error(), path) {
		t.Errorf("err = %v, want one naming %s", err, path)
	}
	if _, err := configfile.Load(filepath.Join(t.TempDir(), "missing.yaml"), env()); err == nil || !strings.Contains(err.Error(), "missing.yaml") {
		t.Errorf("missing file: err = %v", err)
	}
}

func TestAMalformedValueIsNamedWithItsLine(t *testing.T) {
	for _, c := range []struct{ body, want string }{
		{"check_github_updates: maybe\n", "line 1"},
		{"root_folders:\n  movies: /data/movies\n  series: [/s]\n", "line 2"},
		{"account: [admin]\n", "line 1"},
		{"account:\n  username: a\n  username: b\n", "line 3"},
		{"account: {username: a\n", "line"},
	} {
		if _, err := configfile.Load(write(t, c.body), env()); err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%q: err = %v, want one with %q", c.body, err, c.want)
		}
	}
}

func TestADeclaredSectionNamesEveryField(t *testing.T) {
	for _, c := range []struct{ body, want string }{
		{"account:\n  password_env: PW\n", "account.username"},
		{"account:\n  username: admin\n", "account.password_env"},
		{"language_region:\n  primary_language: de\n", "language_region.release_date_country"},
		{"language_region:\n  release_date_country: DE\n", "language_region.primary_language"},
		{"root_folders:\n  movies: [/m]\n", "root_folders.series"},
		{"root_folders:\n  series: [/s]\n", "root_folders.movies"},
		{"reverse_proxy:\n  trusted_proxies: []\n  header: Remote-User\n", "reverse_proxy.enabled"},
		{"reverse_proxy:\n  enabled: false\n  header: Remote-User\n", "reverse_proxy.trusted_proxies"},
		{"reverse_proxy:\n  enabled: false\n  trusted_proxies: []\n", "reverse_proxy.header"},
		{"check_github_updates:\n", "check_github_updates"},
	} {
		_, err := configfile.Load(write(t, c.body), env("PW", "correct horse"))
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%q: err = %v, want one naming %s", c.body, err, c.want)
		}
	}
}

func TestAMissingPasswordVariableIsNamedWithoutAValue(t *testing.T) {
	path := write(t, "account:\n  username: admin\n  password_env: KESTREL_ADMIN_PASSWORD\n")
	for _, getenv := range []func(string) string{env(), env("KESTREL_ADMIN_PASSWORD", "")} {
		_, err := configfile.Load(path, getenv)
		if err == nil || !strings.Contains(err.Error(), "account.password_env") || !strings.Contains(err.Error(), "KESTREL_ADMIN_PASSWORD") {
			t.Errorf("err = %v, want one naming the field and the variable", err)
		}
	}
}

func TestAPasswordGivenAsTheVariableIsNotEchoed(t *testing.T) {
	path := write(t, "account:\n  username: admin\n  password_env: \"hunter2 secret!\"\n")
	_, err := configfile.Load(path, env())
	if err == nil || !strings.Contains(err.Error(), "account.password_env") {
		t.Fatalf("err = %v, want one naming the field", err)
	}
	if strings.Contains(err.Error(), "hunter2") {
		t.Errorf("the error repeats the value: %v", err)
	}
}

func TestThePasswordNeverShowsInTheFile(t *testing.T) {
	f, err := configfile.Load(write(t, "account:\n  username: admin\n  password_env: PW\n"), env("PW", "hunter2-secret"))
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range []string{fmt.Sprintf("%v", *f.Account), fmt.Sprintf("%+v", *f.Account), fmt.Sprintf("%#v", *f.Account), fmt.Sprint(f.Account.Password)} {
		if strings.Contains(s, "hunter2-secret") {
			t.Errorf("printing the file shows the password: %s", s)
		}
	}
}
