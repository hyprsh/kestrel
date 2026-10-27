package api_test

import (
	"context"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/api"
	"github.com/hyprsh/kestrel/internal/plextv/plextvtest"
	"github.com/hyprsh/kestrel/internal/settings"
)

type plexSignInJSON struct {
	Enabled         bool     `json:"enabled"`
	Instance        *string  `json:"instance"`
	Users           []string `json:"users"`
	FromConfigFile  bool     `json:"from_config_file"`
	Watchlist       bool     `json:"watchlist"`
	WatchAhead      bool     `json:"watch_ahead"`
	Labels          bool     `json:"labels"`
	PosterBadge     bool     `json:"poster_badge"`
	PosterBadgeDays *int     `json:"poster_badge_days"`
	UserRootFolders []struct {
		User   string  `json:"user"`
		Movies *string `json:"movies"`
		Series *string `json:"series"`
	} `json:"user_root_folders"`
}

// plexRoots gives the household two Movie Root folders and one for Series.
func plexRoots(t *testing.T, b *browser) (movies, kids, series string) {
	t.Helper()
	dir := t.TempDir()
	movies, kids, series = dir+"/movies", dir+"/kids", dir+"/tv"
	mkdirs(t, movies, kids, series)
	body := `{"root_folders":{"movies":["` + movies + `","` + kids + `"],"series":["` + series + `"]}}`
	if r := b.valid("PATCH", "/settings", body); r.Status != 200 {
		t.Fatalf("root folders = %d %s", r.Status, r.Body)
	}
	return movies, kids, series
}

func TestPlexSignInSettingsAreSavedAndReadBack(t *testing.T) {
	t.Parallel()
	h := newHousehold(t, "")
	_, kids, _ := plexRoots(t, h.admin)

	body := `{"enabled":true,"watchlist":false,"watch_ahead":false,"labels":false,"poster_badge":false,"poster_badge_days":null,"instance":" Plex ","users":[" anna ","Kim"],"user_root_folders":[{"user":"Anna","movies":"` + kids + `","series":null}]}`
	r := h.admin.valid("PUT", "/settings/plex-sign-in", body)
	if r.Status != 200 {
		t.Fatalf("PUT = %d %s", r.Status, r.Body)
	}
	got := decode[plexSignInJSON](t, h.admin.valid("GET", "/settings/plex-sign-in", ""))
	if !got.Enabled || got.Instance == nil || *got.Instance != "Plex" || len(got.Users) != 2 || got.Users[0] != "anna" || got.FromConfigFile {
		t.Errorf("settings = %+v", got)
	}
	if len(got.UserRootFolders) != 1 || got.UserRootFolders[0].User != "Anna" || *got.UserRootFolders[0].Movies != kids || got.UserRootFolders[0].Series != nil {
		t.Errorf("user_root_folders = %+v", got.UserRootFolders)
	}
}

func switches(h *plexHousehold) (api.PlexSwitches, error) {
	return api.LoadPlexSwitches(context.Background(), settings.New(h.st))
}

func TestPlexSwitchesAreOffUntilSetAndTheBadgeLastsAMonthUnlessSaid(t *testing.T) {
	t.Parallel()
	h := newHousehold(t, "")

	got := decode[plexSignInJSON](t, h.admin.valid("GET", "/settings/plex-sign-in", ""))
	if got.Watchlist || got.WatchAhead || got.Labels || got.PosterBadge || got.PosterBadgeDays != nil {
		t.Errorf("with none set: %+v", got)
	}
	if sw, err := switches(h); err != nil || sw != (api.PlexSwitches{PosterBadgeDays: 30}) {
		t.Errorf("switches with none set = %+v, %v", sw, err)
	}

	r := h.admin.valid("PUT", "/settings/plex-sign-in", `{"enabled":true,"watchlist":true,"watch_ahead":true,"labels":true,"poster_badge":true,"poster_badge_days":7,"instance":"Plex","users":[],"user_root_folders":[]}`)
	if r.Status != 200 {
		t.Fatalf("PUT = %d %s", r.Status, r.Body)
	}
	got = decode[plexSignInJSON](t, h.admin.valid("GET", "/settings/plex-sign-in", ""))
	if !got.Watchlist || !got.WatchAhead || !got.Labels || !got.PosterBadge || got.PosterBadgeDays == nil || *got.PosterBadgeDays != 7 {
		t.Errorf("read back: %+v", got)
	}
	if sw, err := switches(h); err != nil || sw != (api.PlexSwitches{Watchlist: true, WatchAhead: true, Labels: true, PosterBadge: true, PosterBadgeDays: 7}) {
		t.Errorf("switches = %+v, %v", sw, err)
	}

	// Unset days read back as 30, and a day count below 1 is refused.
	h.admin.valid("PUT", "/settings/plex-sign-in", `{"enabled":true,"watchlist":true,"watch_ahead":false,"labels":false,"poster_badge":true,"poster_badge_days":null,"instance":"Plex","users":[],"user_root_folders":[]}`)
	if sw, _ := switches(h); sw != (api.PlexSwitches{Watchlist: true, PosterBadge: true, PosterBadgeDays: 30}) {
		t.Errorf("switches with no days = %+v", sw)
	}
	for _, days := range []string{"0", "-1"} {
		r := h.admin.valid("PUT", "/settings/plex-sign-in", `{"enabled":true,"watchlist":false,"watch_ahead":false,"labels":false,"poster_badge":false,"poster_badge_days":`+days+`,"instance":"Plex","users":[],"user_root_folders":[]}`)
		if r.Status != 422 || !strings.Contains(r.Body, `"field":"poster_badge_days"`) {
			t.Errorf("days %s = %d %s, want 422 on poster_badge_days", days, r.Status, r.Body)
		}
	}

	// Plex sign-in off means the features are off, whatever their switches say.
	h.admin.valid("PUT", "/settings/plex-sign-in", `{"enabled":false,"watchlist":true,"watch_ahead":true,"labels":true,"poster_badge":true,"poster_badge_days":9,"instance":"Plex","users":[],"user_root_folders":[]}`)
	if sw, _ := switches(h); sw != (api.PlexSwitches{PosterBadgeDays: 9}) {
		t.Errorf("switches with sign-in off = %+v", sw)
	}
}

func TestPlexSignInSettingsAreValidated(t *testing.T) {
	t.Parallel()
	tv := plextvtest.New(t)
	in := newInstance(t, "", withFakes(t), withPlex(t, tv))
	h := household(t, in, tv)
	movies, kids, series := plexRoots(t, h.admin)
	if r := h.admin.valid("POST", "/plugin-instances", `{"plugin_id":"fake","name":"SABnzbd","config":{"api_key":"sk"}}`); r.Status != 201 {
		t.Fatalf("client = %d %s", r.Status, r.Body)
	}
	other := "/somewhere/else"

	for _, c := range []struct{ name, body, field, code string }{
		{"enabled without an instance", `{"enabled":true,"watchlist":false,"watch_ahead":false,"labels":false,"poster_badge":false,"poster_badge_days":null,"instance":null,"users":[],"user_root_folders":[]}`, "instance", "required"},
		{"enabled with a blank instance", `{"enabled":true,"watchlist":false,"watch_ahead":false,"labels":false,"poster_badge":false,"poster_badge_days":null,"instance":"  ","users":[],"user_root_folders":[]}`, "instance", "required"},
		{"an instance that does not exist", `{"enabled":true,"watchlist":false,"watch_ahead":false,"labels":false,"poster_badge":false,"poster_badge_days":null,"instance":"Nope","users":[],"user_root_folders":[]}`, "instance", "not_found"},
		{"an instance of another plugin", `{"enabled":true,"watchlist":false,"watch_ahead":false,"labels":false,"poster_badge":false,"poster_badge_days":null,"instance":"SABnzbd","users":[],"user_root_folders":[]}`, "instance", "wrong_plugin"},
		{"a blank user", `{"enabled":true,"watchlist":false,"watch_ahead":false,"labels":false,"poster_badge":false,"poster_badge_days":null,"instance":"Plex","users":["anna"," "],"user_root_folders":[]}`, "users[1]", "required"},
		{"a user twice, ignoring case", `{"enabled":true,"watchlist":false,"watch_ahead":false,"labels":false,"poster_badge":false,"poster_badge_days":null,"instance":"Plex","users":["Anna","kim","ANNA"],"user_root_folders":[]}`, "users[2]", "duplicate"},
		{"a blank folder user", `{"enabled":true,"watchlist":false,"watch_ahead":false,"labels":false,"poster_badge":false,"poster_badge_days":null,"instance":"Plex","users":[],"user_root_folders":[{"user":"","movies":null,"series":null}]}`, "user_root_folders[0].user", "required"},
		{"a folder user twice, ignoring case", `{"enabled":true,"watchlist":false,"watch_ahead":false,"labels":false,"poster_badge":false,"poster_badge_days":null,"instance":"Plex","users":[],"user_root_folders":[{"user":"anna","movies":null,"series":null},{"user":"ANNA","movies":null,"series":null}]}`, "user_root_folders[1].user", "duplicate"},
		{"a Movie folder that is not a Movie Root folder", `{"enabled":true,"watchlist":false,"watch_ahead":false,"labels":false,"poster_badge":false,"poster_badge_days":null,"instance":"Plex","users":[],"user_root_folders":[{"user":"anna","movies":"` + other + `","series":null}]}`, "user_root_folders[0].movies", "not_found"},
		{"a Series folder that is a Movie Root folder", `{"enabled":true,"watchlist":false,"watch_ahead":false,"labels":false,"poster_badge":false,"poster_badge_days":null,"instance":"Plex","users":[],"user_root_folders":[{"user":"anna","movies":null,"series":"` + movies + `"}]}`, "user_root_folders[0].series", "not_found"},
	} {
		r := h.admin.valid("PUT", "/settings/plex-sign-in", c.body)
		if r.Status != 422 || !strings.Contains(r.Body, `"field":"`+c.field+`"`) || !strings.Contains(r.Body, `"code":"`+c.code+`"`) {
			t.Errorf("%s = %d %s, want 422 %s/%s", c.name, r.Status, r.Body, c.field, c.code)
		}
	}
	// Nothing above was saved.
	if got := decode[plexSignInJSON](t, h.admin.valid("GET", "/settings/plex-sign-in", "")); !got.Enabled || len(got.Users) != 0 {
		t.Errorf("settings = %+v, want the rejected ones unsaved", got)
	}

	// Switched off, the instance is not needed, and good folders pass.
	for _, body := range []string{
		`{"enabled":false,"watchlist":false,"watch_ahead":false,"labels":false,"poster_badge":false,"poster_badge_days":null,"instance":null,"users":[],"user_root_folders":[]}`,
		`{"enabled":false,"watchlist":false,"watch_ahead":false,"labels":false,"poster_badge":false,"poster_badge_days":null,"instance":"Gone","users":[],"user_root_folders":[]}`,
		`{"enabled":true,"watchlist":false,"watch_ahead":false,"labels":false,"poster_badge":false,"poster_badge_days":null,"instance":"Plex","users":["anna"],"user_root_folders":[{"user":"anna","movies":"` + kids + `","series":"` + series + `"},{"user":"ben","movies":null,"series":null}]}`,
	} {
		if r := h.admin.valid("PUT", "/settings/plex-sign-in", body); r.Status != 200 {
			t.Errorf("PUT %s = %d %s", body, r.Status, r.Body)
		}
	}
	if r := h.admin.valid("PUT", "/settings/plex-sign-in", ""); r.Status != 400 && r.Status != 422 {
		t.Errorf("PUT without a body = %d", r.Status)
	}
}

const declaredPlexInstance = `plugin_instances:
  - name: Plex
    plugin_id: plex
    config:
      url: %s
      token_env: PLEX_TOKEN
`

func declaredPlex(tvURL string) string {
	return strings.Replace(declaredPlexInstance, "%s", tvURL, 1)
}

func TestADeclaredPlexSignInIsAppliedAndReadOnly(t *testing.T) {
	t.Parallel()
	tv := plextvtest.New(t)
	in := newInstance(t, "", withPlex(t, tv))
	h := household(t, in, tv)
	movies, kids, series := plexRoots(t, h.admin)
	_ = movies

	in.mustDeclare(declaredPlex(tv.URL)+`root_folders:
  movies: ["`+movies+`", "`+kids+`"]
  series: ["`+series+`"]
plex_sign_in:
  enabled: true
  instance: Plex
  users: [Anna, kim]
  watchlist: true
  labels: true
  poster_badge_days: 14
  user_root_folders:
    ANNA: {movies: "`+kids+`"}
    kim: {}
`, "PLEX_TOKEN", plextvtest.OwnerToken, "KESTREL_ADMIN_PASSWORD", "correct horse")

	b, r := in.loginAs("admin", "correct horse")
	if r.Status != 204 {
		t.Fatalf("login = %d %s", r.Status, r.Body)
	}
	got := decode[plexSignInJSON](t, b.valid("GET", "/settings/plex-sign-in", ""))
	if !got.Enabled || !got.FromConfigFile || *got.Instance != "Plex" || len(got.Users) != 2 || len(got.UserRootFolders) != 2 {
		t.Fatalf("settings = %+v", got)
	}
	if f := got.UserRootFolders; f[0].User != "ANNA" || *f[0].Movies != kids || f[0].Series != nil || f[1].User != "kim" || f[1].Movies != nil {
		t.Errorf("user_root_folders = %+v, want them sorted by user", f)
	}
	if !got.Watchlist || got.WatchAhead || !got.Labels || got.PosterBadge || got.PosterBadgeDays == nil || *got.PosterBadgeDays != 14 {
		t.Errorf("declared switches = %+v", got)
	}
	in.conflictNamingTheFile("PUT /settings/plex-sign-in", b.valid("PUT", "/settings/plex-sign-in", `{"enabled":false,"watchlist":false,"watch_ahead":false,"labels":false,"poster_badge":false,"poster_badge_days":null,"instance":null,"users":[],"user_root_folders":[]}`))

	// Requesters sign in under the declared rules.
	if r := h.signIn(in.browser(), "anna-token"); r.Status != 204 {
		t.Errorf("anna, on the declared list = %d %s", r.Status, r.Body)
	}
	if r := h.signIn(in.browser(), "ben-token"); r.Status != 403 {
		t.Errorf("ben, not on it = %d %s", r.Status, r.Body)
	}

	// A second start with the same file writes nothing.
	in.restart()
	before := in.writes()
	if err := in.app.EnforceConfigFile(context.Background()); err != nil {
		t.Fatal(err)
	}
	if after := in.writes(); after != before {
		t.Errorf("a second apply changed %d rows", after-before)
	}

	// Leaving the section out hands it back to the UI, with what was declared kept.
	in.mustDeclare(declaredPlex(tv.URL), "PLEX_TOKEN", plextvtest.OwnerToken)
	b, _ = in.loginAs("admin", "correct horse")
	got = decode[plexSignInJSON](t, b.valid("GET", "/settings/plex-sign-in", ""))
	if got.FromConfigFile || !got.Enabled {
		t.Errorf("after leaving the section out: %+v", got)
	}
	if r := b.valid("PUT", "/settings/plex-sign-in", `{"enabled":false,"watchlist":false,"watch_ahead":false,"labels":false,"poster_badge":false,"poster_badge_days":null,"instance":null,"users":[],"user_root_folders":[]}`); r.Status != 200 {
		t.Errorf("PUT once the file leaves it out = %d %s", r.Status, r.Body)
	}
}

func TestAPlexSignInTheFileDeclaresIsCheckedAgainstTheFilesOwnInstancesAndFolders(t *testing.T) {
	t.Parallel()
	tv := plextvtest.New(t)
	in := newInstance(t, "", withFakes(t), withPlex(t, tv))
	dir := t.TempDir()
	mkdirs(t, dir+"/movies", dir+"/kids", dir+"/tv")
	env := []string{"PLEX_TOKEN", plextvtest.OwnerToken, "CLIENT_KEY", "sk", "INDEXER_KEY", "ik", "KESTREL_ADMIN_PASSWORD", "correct horse"}
	roots := "root_folders:\n  movies: [\"" + dir + "/movies\"]\n  series: [\"" + dir + "/tv\"]\n"
	plexInst := declaredPlex(tv.URL)
	both := strings.Replace(declaredInstances, "plugin_instances:\n", "", 1)
	instances := plexInst + both

	for _, c := range []struct{ name, body, want string }{
		{"an instance that is not declared", roots + plexInst + "plex_sign_in:\n  enabled: true\n  instance: Plex2\n", "plex_sign_in.instance"},
		{"no instance while enabled", roots + plexInst + "plex_sign_in:\n  enabled: true\n", "plex_sign_in.instance"},
		{"an instance of another plugin", roots + instances + "plex_sign_in:\n  enabled: true\n  instance: SABnzbd\n", "plex_sign_in.instance"},
		{"a user twice", roots + plexInst + "plex_sign_in:\n  enabled: true\n  instance: Plex\n  users: [anna, Anna]\n", "plex_sign_in.users[1]"},
		{"a folder user twice", roots + plexInst + "plex_sign_in:\n  enabled: true\n  instance: Plex\n  user_root_folders:\n    anna: {}\n    Anna: {}\n", "plex_sign_in.user_root_folders[1].user"},
		{"a folder that is not a Root folder", roots + plexInst + "plex_sign_in:\n  enabled: true\n  instance: Plex\n  user_root_folders:\n    anna: {movies: \"" + dir + "/kids\"}\n", "plex_sign_in.user_root_folders[0].movies"},
	} {
		err := in.declare(c.body, env...)
		if err == nil || !strings.Contains(err.Error(), c.want) || !strings.Contains(err.Error(), in.opts.ConfigFile.Path) {
			t.Errorf("%s: err = %v, want one naming the file and %s", c.name, err, c.want)
		}
	}
	// Declared together, the file's own instance and folders are enough.
	in.mustDeclare(roots+plexInst+"plex_sign_in:\n  enabled: true\n  instance: Plex\n  user_root_folders:\n    anna: {movies: \""+dir+"/movies\"}\n", env...)
}

func TestAChangedDeclaredPasswordEndsAdminSessionsButNotRequesters(t *testing.T) {
	t.Parallel()
	h := newHousehold(t, "")
	b := h.requester("anna-token")
	admin, r := h.loginAs("admin", "correct horse")
	if r.Status != 204 {
		t.Fatalf("login = %d", r.Status)
	}
	h.mustDeclare(declaredAccount, "KESTREL_ADMIN_PASSWORD", "a brand new one")

	if r := admin.get("/auth/me"); r.Status != 401 {
		t.Errorf("the admin session = %d, want it ended", r.Status)
	}
	if r := b.get("/auth/me"); r.Status != 200 {
		t.Errorf("the Requester's session = %d, want it kept", r.Status)
	}
}
