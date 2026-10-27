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
plex_sign_in:
  enabled: true
  instance: Plex
  users: [anna, Ben Smith]
  watchlist: true
  watch_ahead: true
  labels: true
  poster_badge: true
  poster_badge_days: 14
  user_root_folders:
    anna: {movies: /data/kids/movies}
    ben:
      series: /data/kids/tv
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
	wantPlex := &configfile.PlexSignIn{
		Enabled: ptr(true), Instance: "Plex", Users: []string{"anna", "Ben Smith"},
		Watchlist: true, WatchAhead: true, Labels: true, PosterBadge: true, PosterBadgeDays: ptr(14),
		UserRootFolders: map[string]configfile.PlexUserRootFolders{
			"anna": {Movies: ptr("/data/kids/movies")},
			"ben":  {Series: ptr("/data/kids/tv")},
		},
	}
	if !reflect.DeepEqual(f.PlexSignIn, wantPlex) || !f.Declares(configfile.SectionPlexSignIn) {
		t.Errorf("plex_sign_in = %+v", f.PlexSignIn)
	}
	if f.CheckGitHubUpdates == nil || *f.CheckGitHubUpdates {
		t.Errorf("check_github_updates = %v", f.CheckGitHubUpdates)
	}
}

func TestPlexSignInNeedsOnlyEnabled(t *testing.T) {
	f, err := configfile.Load(write(t, "plex_sign_in:\n  enabled: false\n"), env())
	if err != nil {
		t.Fatal(err)
	}
	if p := f.PlexSignIn; p == nil || p.Enabled == nil || *p.Enabled || p.Instance != "" || p.Users != nil || p.UserRootFolders != nil ||
		p.Watchlist || p.WatchAhead || p.Labels || p.PosterBadge || p.PosterBadgeDays != nil {
		t.Errorf("plex_sign_in = %+v", p)
	}
}

func TestPlexSwitchesAreBoolsAndABadgeLifeOfAtLeastADay(t *testing.T) {
	for _, c := range []struct{ body, want string }{
		{"plex_sign_in:\n  enabled: true\n  poster_badge_days: 0\n", "plex_sign_in.poster_badge_days: must be at least 1"},
		{"plex_sign_in:\n  enabled: true\n  poster_badge_days: -3\n", "plex_sign_in.poster_badge_days: must be at least 1"},
		{"plex_sign_in:\n  enabled: true\n  poster_badge_days: soon\n", "line 3"},
		{"plex_sign_in:\n  enabled: true\n  watchlist: maybe\n", "line 3"},
		{"plex_sign_in:\n  enabled: true\n  watch_ahead: 1\n", "line 3"},
	} {
		_, err := configfile.Load(write(t, c.body), env())
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%q: err = %v, want one with %q", c.body, err, c.want)
		}
	}
	f, err := configfile.Load(write(t, "plex_sign_in:\n  enabled: false\n  poster_badge_days: 1\n"), env())
	if err != nil || f.PlexSignIn.PosterBadgeDays == nil || *f.PlexSignIn.PosterBadgeDays != 1 {
		t.Errorf("a day: %+v, %v", f, err)
	}
}

func TestAPlexUserIsDeclaredOnceAndItsKindsAreKnown(t *testing.T) {
	for _, c := range []struct{ body, want string }{
		{"plex_sign_in:\n  enabled: true\n  user_root_folders:\n    anna: {movies: /a}\n    anna: {movies: /b}\n", "line 5"},
		{"plex_sign_in:\n  enabled: true\n  user_root_folders:\n    anna: {anime: /a}\n", "line 4: unknown key plex_sign_in.user_root_folders.anna.anime"},
		{"plex_sign_in:\n  enabled: true\n  token: secret-token\n", "line 3: unknown key plex_sign_in.token"},
		{"plex_sign_in:\n  enabled: true\n  users: anna\n", "line 3"},
	} {
		_, err := configfile.Load(write(t, c.body), env())
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%q: err = %v, want one with %q", c.body, err, c.want)
		} else if strings.Contains(err.Error(), "secret-token") {
			t.Errorf("the error repeats a value: %v", err)
		}
	}
}

func TestEverySectionIsOptional(t *testing.T) {
	for _, body := range []string{"", "# nothing declared\n", "{}\n"} {
		f, err := configfile.Load(write(t, body), env())
		if err != nil {
			t.Fatalf("%q: %v", body, err)
		}
		if f.Account != nil || f.LanguageRegion != nil || f.RootFolders != nil || f.Profiles != nil ||
			f.PluginInstances != nil || f.ReverseProxy != nil || f.PlexSignIn != nil || f.CheckGitHubUpdates != nil {
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
		{"plex_sign_in:\n  instance: Plex\n", "plex_sign_in.enabled"},
		{"check_github_updates:\n", "check_github_updates"},
		{"profiles:\n  hd-primary:\n    enabled: true\n    original_fallback: false\n    default_movies: true\n", "profiles.hd-primary.default_series"},
		{"profiles:\n  4k-primary:\n", "profiles.4k-primary.enabled"},
		{"profiles:\n  4k-primary:\n    enabled: true\n    default_movies: false\n    default_series: false\n", "profiles.4k-primary.original_language"},
		{"plugin_instances:\n  - plugin_id: sabnzbd\n", "plugin_instances[0].name"},
		{"plugin_instances:\n  - name: \"  \"\n    plugin_id: sabnzbd\n", "plugin_instances[0].name"},
		{"plugin_instances:\n  - name: SABnzbd\n", "plugin_instances[0].plugin_id"},
	} {
		_, err := configfile.Load(write(t, c.body), env("PW", "correct horse"))
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%q: err = %v, want one naming %s", c.body, err, c.want)
		}
	}
}

func TestAProfileDeclaresItsOriginalLanguageChoice(t *testing.T) {
	const head = "profiles:\n  hd-primary:\n    enabled: true\n    default_movies: true\n    default_series: true\n"
	for _, c := range []struct{ body, want string }{
		{head + "    original_language: offer\n", "offer"},
		// The deprecated original_fallback still works: true accepts, false rejects.
		{head + "    original_fallback: true\n", "accept"},
		{head + "    original_fallback: false\n", "reject"},
		{head + "    original_fallback: true\n    original_language: accept\n", "accept"},
	} {
		f, err := configfile.Load(write(t, c.body), env())
		if err != nil {
			t.Fatalf("%q: %v", c.body, err)
		}
		if got := f.Profiles["hd-primary"].Choice(); string(got) != c.want {
			t.Errorf("%q: choice = %q, want %q", c.body, got, c.want)
		}
	}
	_, err := configfile.Load(write(t, head+"    original_fallback: true\n    original_language: offer\n"), env())
	if err == nil || !strings.Contains(err.Error(), "profiles.hd-primary.original_language") {
		t.Errorf("disagreeing fields: err = %v, want one naming profiles.hd-primary.original_language", err)
	}
}

func TestDeclaredInstanceNamesAreUnique(t *testing.T) {
	_, err := configfile.Load(write(t, "plugin_instances:\n  - name: SABnzbd\n    plugin_id: sabnzbd\n  - name: \" SABnzbd\"\n    plugin_id: fake\n"), env())
	if err == nil || !strings.Contains(err.Error(), "line 4") || !strings.Contains(err.Error(), `"SABnzbd"`) {
		t.Errorf("err = %v, want one naming the second SABnzbd and its line", err)
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

// sabFields is a manifest's view of SABnzbd: api_key is its secret.
func sabFields(key string) (known, secret bool) {
	switch key {
	case "url", "category":
		return true, false
	case "api_key":
		return true, true
	}
	return false, false
}

func loadInstance(t *testing.T, config string, getenv func(string) string) configfile.PluginInstance {
	t.Helper()
	f, err := configfile.Load(write(t, "plugin_instances:\n  - name: SABnzbd\n    plugin_id: sabnzbd\n    config:\n"+config), getenv)
	if err != nil {
		t.Fatal(err)
	}
	return f.PluginInstances[0]
}

func TestAnInstanceConfigResolvesItsSecretsFromTheEnvironment(t *testing.T) {
	p := loadInstance(t, "      url: http://sab:8080\n      api_key_env: SABNZBD_API_KEY\n      category: 7\n", env("SABNZBD_API_KEY", "s3cret-key"))
	cfg, err := p.ConfigValues(sabFields)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"url": "http://sab:8080", "api_key": "s3cret-key", "category": float64(7)}
	if !reflect.DeepEqual(cfg, want) {
		t.Errorf("config = %#v, want %#v", cfg, want)
	}
	if p.Line != 2 {
		t.Errorf("line = %d", p.Line)
	}
}

func TestAnInstanceWithoutConfigHasAnEmptyOne(t *testing.T) {
	f, err := configfile.Load(write(t, "plugin_instances:\n  - name: SABnzbd\n    plugin_id: sabnzbd\n"), env())
	if err != nil {
		t.Fatal(err)
	}
	if cfg, err := f.PluginInstances[0].ConfigValues(sabFields); err != nil || len(cfg) != 0 {
		t.Errorf("config = %v, %v", cfg, err)
	}
}

func TestAnInstanceConfigIsRejectedWithoutItsSecret(t *testing.T) {
	for _, c := range []struct {
		name, config string
		getenv       func(string) string
		want         []string
	}{
		{"inline secret", "      api_key: hunter2-secret\n", env(), []string{"line 5", `"SABnzbd"`, "config.api_key", "api_key_env"}},
		{"unknown key", "      url: http://sab\n      apikey: hunter2-secret\n", env(), []string{"line 6", `"SABnzbd"`, "config.apikey", "unknown key"}},
		{"env on a plain field", "      url_env: SAB_URL\n", env("SAB_URL", "http://sab"), []string{"line 5", "config.url_env", "unknown key"}},
		{"unset variable", "      api_key_env: SABNZBD_API_KEY\n", env(), []string{`"SABnzbd"`, "config.api_key_env", "SABNZBD_API_KEY"}},
		{"secret as the variable", "      api_key_env: hunter2-secret!\n", env(), []string{"config.api_key_env"}},
		{"both", "      api_key: hunter2-secret\n      api_key_env: K\n", env("K", "hunter2-secret"), []string{"config.api_key"}},
		{"not a map", "      [a, b]\n", env(), []string{"line 5", "config"}},
	} {
		t.Run(c.name, func(t *testing.T) {
			_, err := loadInstance(t, c.config, c.getenv).ConfigValues(sabFields)
			if err == nil {
				t.Fatal("no error")
			}
			for _, w := range c.want {
				if !strings.Contains(err.Error(), w) {
					t.Errorf("err = %v, want %q in it", err, w)
				}
			}
			if strings.Contains(err.Error(), "hunter2") {
				t.Errorf("the error repeats a value: %v", err)
			}
		})
	}
}
