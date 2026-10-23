package api_test

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/configfile"
	"github.com/hyprsh/kestrel/internal/jobs"
)

// declare writes body as the instance's Config File, loads it with the
// environment in kv and restarts the instance with it. It returns the
// startup error, as the binary would exit with it.
func (in *instance) declare(body string, kv ...string) error {
	in.t.Helper()
	path := filepath.Join(in.opts.ConfigDir, "kestrel.yaml")
	if in.opts.ConfigDir == "" {
		path = filepath.Join(in.t.TempDir(), "kestrel.yaml")
	}
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		in.t.Fatal(err)
	}
	vars := map[string]string{}
	for i := 0; i+1 < len(kv); i += 2 {
		vars[kv[i]] = kv[i+1]
	}
	f, err := configfile.Load(path, func(k string) string { return vars[k] })
	if err != nil {
		return err
	}
	in.opts.ConfigFile = f
	return in.start()
}

// mustDeclare is declare for a file that must apply.
func (in *instance) mustDeclare(body string, kv ...string) {
	in.t.Helper()
	if err := in.declare(body, kv...); err != nil {
		in.t.Fatal(err)
	}
}

// loginAs logs in with a username and password and returns the browser.
func (in *instance) loginAs(username, password string) (*browser, reply) {
	in.t.Helper()
	b := in.browser()
	return b, b.post("/auth/login", `{"username":"`+username+`","password":"`+password+`"}`)
}

// writes counts the rows the single write connection has changed so far.
func (in *instance) writes() int64 {
	in.t.Helper()
	var n int64
	if err := in.st.Write().QueryRowContext(context.Background(), "SELECT total_changes()").Scan(&n); err != nil {
		in.t.Fatal(err)
	}
	return n
}

const declaredAccount = "account:\n  username: admin\n  password_env: KESTREL_ADMIN_PASSWORD\n"

func TestADeclaredAccountIsCreatedOnAFreshStart(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	in.mustDeclare(declaredAccount, "KESTREL_ADMIN_PASSWORD", "correct horse")

	b, r := in.loginAs("admin", "correct horse")
	if r.Status != 204 {
		t.Fatalf("login with the declared account = %d %s", r.Status, r.Body)
	}
	if s := b.valid("GET", "/setup", ""); !strings.Contains(s.Body, `"account_exists":true`) {
		t.Errorf("setup = %s", s.Body)
	}
}

func TestADeclaredAccountIsRenamedAndItsPasswordSetOnEveryStart(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	in.setUp() // admin / correct horse, made in the UI
	old := in.login()

	in.mustDeclare("account:\n  username: kestrel\n  password_env: PW\n", "PW", "battery staple")

	if _, r := in.loginAs("admin", "correct horse"); r.Status != 401 {
		t.Errorf("login with the UI's account = %d, want 401", r.Status)
	}
	b, r := in.loginAs("kestrel", "battery staple")
	if r.Status != 204 {
		t.Fatalf("login with the declared account = %d %s", r.Status, r.Body)
	}
	if me := b.valid("GET", "/auth/me", ""); !strings.Contains(me.Body, `"username":"kestrel"`) {
		t.Errorf("me = %s", me.Body)
	}
	if r := old.get("/auth/me"); r.Status != 401 {
		t.Errorf("a session from before the password changed = %d, want 401", r.Status)
	}
}

func TestARenameAloneKeepsTheSessions(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	in.mustDeclare(declaredAccount, "KESTREL_ADMIN_PASSWORD", "correct horse")
	b, _ := in.loginAs("admin", "correct horse")

	in.mustDeclare("account:\n  username: root\n  password_env: PW\n", "PW", "correct horse")

	if me := b.valid("GET", "/auth/me", ""); me.Status != 200 || !strings.Contains(me.Body, `"username":"root"`) {
		t.Errorf("me after the rename = %d %s", me.Status, me.Body)
	}
}

// settingsFile declares every section #93 applies, with Root folders under data.
func settingsFile(data string) string {
	return declaredAccount + `
language_region:
  primary_language: de
  release_date_country: AT
root_folders:
  movies: [` + data + `/movies, ` + data + `/movies-4k]
  series: [` + data + `/tv]
reverse_proxy:
  enabled: true
  trusted_proxies: [10.0.0.0/8, 192.168.1.2]
  header: X-Remote-User
check_github_updates: false
`
}

type declaredSettingsJSON struct {
	LanguageRegion struct {
		PrimaryLanguage    string `json:"primary_language"`
		ReleaseDateCountry string `json:"release_date_country"`
	} `json:"language_region"`
	RootFolders struct {
		Movies []string `json:"movies"`
		Series []string `json:"series"`
	} `json:"root_folders"`
	CheckGitHubUpdates bool `json:"check_github_updates"`
}

type reverseProxyJSON struct {
	Enabled        bool     `json:"enabled"`
	TrustedProxies []string `json:"trusted_proxies"`
	Header         string   `json:"header"`
}

func TestAFreshStartTakesEveryDeclaredSetting(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	data := t.TempDir()
	mkdirs(t, data+"/movies", data+"/movies-4k", data+"/tv")
	in.mustDeclare(settingsFile(data), "KESTREL_ADMIN_PASSWORD", "correct horse")
	b := in.login()

	s := decode[declaredSettingsJSON](t, b.valid("GET", "/settings", ""))
	if s.LanguageRegion.PrimaryLanguage != "de" || s.LanguageRegion.ReleaseDateCountry != "AT" {
		t.Errorf("language_region = %+v", s.LanguageRegion)
	}
	if !slices.Equal(s.RootFolders.Movies, []string{data + "/movies", data + "/movies-4k"}) || !slices.Equal(s.RootFolders.Series, []string{data + "/tv"}) {
		t.Errorf("root_folders = %+v", s.RootFolders)
	}
	if s.CheckGitHubUpdates {
		t.Error("check_github_updates is still on")
	}
	p := decode[reverseProxyJSON](t, b.valid("GET", "/settings/reverse-proxy", ""))
	if !p.Enabled || p.Header != "X-Remote-User" || !slices.Equal(p.TrustedProxies, []string{"10.0.0.0/8", "192.168.1.2"}) {
		t.Errorf("reverse proxy = %+v", p)
	}
	setup := b.valid("GET", "/setup", "").Body
	for _, want := range []string{`"account":"done"`, `"language":"done"`, `"root_folders":"done"`, `"completed":false`} {
		if !strings.Contains(setup, want) {
			t.Errorf("setup = %s, want %s", setup, want)
		}
	}
}

func TestASecondStartWithTheSameFileWritesNothing(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	data := t.TempDir()
	mkdirs(t, data+"/movies", data+"/movies-4k", data+"/tv")
	in.mustDeclare(settingsFile(data), "KESTREL_ADMIN_PASSWORD", "correct horse")

	in.restart()
	before := in.writes()
	if err := in.app.EnforceConfigFile(context.Background()); err != nil {
		t.Fatal(err)
	}
	if after := in.writes(); after != before {
		t.Errorf("the second start changed %d rows", after-before)
	}
}

func TestAChangedDeclaredValueAppliesOnTheNextStart(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	data := t.TempDir()
	mkdirs(t, data+"/movies", data+"/movies-4k", data+"/tv", data+"/shows")
	in.mustDeclare(settingsFile(data), "KESTREL_ADMIN_PASSWORD", "correct horse")

	changed := strings.NewReplacer("AT", "CH", data+"/tv]", data+"/shows, "+data+"/tv]", "enabled: true", "enabled: false",
		"check_github_updates: false", "check_github_updates: true").Replace(settingsFile(data))
	in.mustDeclare(changed, "KESTREL_ADMIN_PASSWORD", "correct horse")
	b := in.login()

	s := decode[declaredSettingsJSON](t, b.valid("GET", "/settings", ""))
	if s.LanguageRegion.ReleaseDateCountry != "CH" || !slices.Equal(s.RootFolders.Series, []string{data + "/shows", data + "/tv"}) || !s.CheckGitHubUpdates {
		t.Errorf("settings = %+v", s)
	}
	if p := decode[reverseProxyJSON](t, b.valid("GET", "/settings/reverse-proxy", "")); p.Enabled {
		t.Errorf("reverse proxy = %+v", p)
	}
}

func TestASectionLeftOutIsNotTouched(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	b := in.setUp()
	if r := b.valid("PATCH", "/settings", `{"language_region":{"primary_language":"fr"},"check_github_updates":false}`); r.Status != 200 {
		t.Fatalf("PATCH /settings = %d %s", r.Status, r.Body)
	}

	in.mustDeclare("reverse_proxy:\n  enabled: false\n  trusted_proxies: []\n  header: Remote-User\n")
	b = in.login()

	s := decode[declaredSettingsJSON](t, b.valid("GET", "/settings", ""))
	if s.LanguageRegion.PrimaryLanguage != "fr" || s.CheckGitHubUpdates {
		t.Errorf("settings = %+v", s)
	}
}

func TestAnInvalidSectionLeavesTheEarlierOnesUnwritten(t *testing.T) {
	t.Parallel()
	data := t.TempDir()
	mkdirs(t, data+"/movies", data+"/movies-4k") // no tv
	for _, c := range []struct{ name, body, want string }{
		{"root folder", settingsFile(data), "root_folders.series[0]"},
		{"language", strings.Replace(settingsFile(data), "primary_language: de", "primary_language: xx", 1), "language_region.primary_language"},
		{"country", strings.Replace(settingsFile(data), "AT", "Austria", 1), "language_region.release_date_country"},
		{"proxy", strings.Replace(settingsFile(data), "192.168.1.2", "proxy.local", 1), "reverse_proxy.trusted_proxies"},
	} {
		// Serial: the cases share data and add and remove its tv folder.
		t.Run(c.name, func(t *testing.T) {
			if c.name != "root folder" {
				mkdirs(t, data+"/tv")
				t.Cleanup(func() { os.Remove(data + "/tv") })
			}
			in := newInstance(t, "")
			err := in.declare(c.body, "KESTREL_ADMIN_PASSWORD", "correct horse")
			if err == nil || !strings.Contains(err.Error(), c.want) || !strings.Contains(err.Error(), in.opts.ConfigFile.Path) {
				t.Fatalf("err = %v, want one naming %s and the file", err, c.want)
			}
			if s := in.browser().valid("GET", "/setup", ""); !strings.Contains(s.Body, `"account_exists":false`) || !strings.Contains(s.Body, `"language":"todo"`) {
				t.Errorf("setup = %s, want nothing written", s.Body)
			}
		})
	}
}

func TestTheFileCompletesSetupWhenTheStoreHasAClientAndAnIndexer(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t) // an enabled download client and indexer, made in the UI
	in := s.in
	mkdirs(t, s.data+"/movies", s.data+"/movies-4k", s.data+"/tv")
	in.mustDeclare(settingsFile(s.data), "KESTREL_ADMIN_PASSWORD", "correct horse")

	if r := in.login().valid("GET", "/setup", ""); !strings.Contains(r.Body, `"completed":true`) {
		t.Errorf("setup = %s, want completed", r.Body)
	}
}

func TestADeclaredPrimaryLanguageRescoresFilesWhenItChanges(t *testing.T) {
	t.Parallel()
	s := newSearchBare(t)
	s.addMovie(t, `{"slot":"standard","profile":"hd-primary"}`)
	s.prober.set(goodProbe(), nil)
	s.download(t, map[string]string{"paddington.mkv": "the movie"})
	s.pass(t, jobs.Poll)
	s.pass(t, jobs.Import)
	before := s.version(t, s.hd)
	if before.File == nil || before.File.Misfit {
		t.Fatalf("version = %+v, want a fitting English file", before)
	}

	s.in.mustDeclare("language_region:\n  primary_language: en\n  release_date_country: GB\n")
	if after := s.version(t, s.hd); after.File == nil || after.File.Misfit {
		t.Fatalf("file = %+v, want it still fitting: the language did not change", after.File)
	}

	s.in.mustDeclare("language_region:\n  primary_language: de\n  release_date_country: DE\n")
	if after := s.version(t, s.hd); after.File == nil || !after.File.Misfit || after.File.Path != before.File.Path {
		t.Fatalf("file = %+v, want the same path, now a misfit for a German household", after.File)
	}
}

func TestAShortDeclaredPasswordFailsStartupWithoutEchoingIt(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	err := in.declare(declaredAccount, "KESTREL_ADMIN_PASSWORD", "hunter2")
	if err == nil || !strings.Contains(err.Error(), "account.password_env") || !strings.Contains(err.Error(), "KESTREL_ADMIN_PASSWORD") {
		t.Fatalf("err = %v, want one naming the field and the variable", err)
	}
	if strings.Contains(err.Error(), "hunter2") {
		t.Errorf("the error repeats the password: %v", err)
	}
	if s := in.browser().valid("GET", "/setup", ""); !strings.Contains(s.Body, `"account_exists":false`) {
		t.Errorf("setup = %s", s.Body)
	}
}

func TestTheFileAcceptsTrustedProxiesWithHeaderLoginOff(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	in.setUp()
	in.mustDeclare("reverse_proxy:\n  enabled: false\n  trusted_proxies: [127.0.0.1]\n  header: Remote-User\n")
	r := in.login().get("/settings/reverse-proxy")
	if r.Status != 200 || !strings.Contains(r.Body, `"enabled":false`) || !strings.Contains(r.Body, `"trusted_proxies":["127.0.0.1"]`) {
		t.Errorf("GET /settings/reverse-proxy = %d %s", r.Status, r.Body)
	}
}
