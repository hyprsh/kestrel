package silo_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/hyprsh/kestrel/internal/api"
	"github.com/hyprsh/kestrel/internal/app"
	"github.com/hyprsh/kestrel/internal/jobs"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
	"github.com/hyprsh/kestrel/internal/plugin"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
	dcfake "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1/fake"
	indexer "github.com/hyprsh/kestrel/internal/plugin/indexer/v1"
	ixfake "github.com/hyprsh/kestrel/internal/plugin/indexer/v1/fake"
	"github.com/hyprsh/kestrel/internal/store"
	"github.com/hyprsh/kestrel/internal/store/storetest"
)

const (
	paddingtonTMDB = 116149
	paddingtonHD   = "Paddington.2014.1080p.BluRay.x264-GRP"
	paddingtonUHD  = "Paddington.2014.2160p.WEB-DL.x265-GRP"
)

// kestrel is a real Kestrel (api.New on a temp SQLite) with the TMDB fixtures,
// an indexer fake and a download-client fake, and an API key for the plugin.
type kestrel struct {
	t   *testing.T
	srv *httptest.Server
	st  *store.Store
	app *app.App
	idx *ixfake.Indexer
	sab *dcfake.Client
	Key string
	// Data is Kestrel's data dir; its media/movies is the first Movies root folder.
	Data string
}

func newKestrel(t *testing.T) *kestrel {
	t.Helper()
	st, err := store.Open(context.Background(), store.Options{Dir: storetest.Dir(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	tmdb := metadatatest.New(t)
	data, config := t.TempDir(), t.TempDir()
	idx, sab := ixfake.New("ik"), dcfake.New("sk")
	reg := plugin.NewRegistry()
	if err := reg.Register(indexer.Contract, idx); err != nil {
		t.Fatal(err)
	}
	if err := reg.Register(downloadclient.Contract, sab); err != nil {
		t.Fatal(err)
	}
	app := app.New(app.Options{
		Options: api.Options{
			Version: "9.9.9", Store: st, CheapPasswordHash: true,
			Web: fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<html></html>")}},
		},
		DataDir: data, ConfigDir: config, Plugins: reg,
		Metadata: metadata.NewTMDB(metadata.TMDBOptions{BaseURL: tmdb.APIBase(), ImageBase: tmdb.ImageBase(), Keys: metadata.StaticKey(metadatatest.Key)}),
		Posters:  metadata.NewPosters(metadata.PostersOptions{ConfigDir: config, ImageBase: tmdb.ImageBase()}),
	})
	srv := httptest.NewServer(app.Handler)
	t.Cleanup(srv.Close)
	k := &kestrel{t: t, srv: srv, st: st, app: app, idx: idx, sab: sab, Data: data}

	jar, _ := cookiejar.New(nil)
	browser := &http.Client{Jar: jar}
	post := func(path, body string) string {
		req, _ := http.NewRequest("POST", srv.URL+"/api/v1"+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", srv.URL)
		res, err := browser.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		raw, _ := io.ReadAll(res.Body)
		if res.StatusCode/100 != 2 {
			t.Fatalf("POST %s = %d %s", path, res.StatusCode, raw)
		}
		return string(raw)
	}
	post("/setup/account", `{"username":"admin","password":"correct horse"}`)
	var key struct {
		Key string `json:"key"`
	}
	if err := json.Unmarshal([]byte(post("/api-key", "")), &key); err != nil {
		t.Fatal(err)
	}
	k.Key = key.Key
	post("/plugin-instances", `{"plugin_id":"fake_indexer","name":"Alpha","config":{"api_key":"ik"}}`)
	post("/plugin-instances", `{"plugin_id":"fake","name":"SABnzbd","config":{"api_key":"sk","movie_category":"films"}}`)
	return k
}

func (k *kestrel) URL() string { return k.srv.URL }

func (k *kestrel) publish(name string) {
	k.t.Helper()
	err := k.idx.Publish(indexer.Release{
		Title: name, IMDBID: "tt1109624", TMDBID: paddingtonTMDB, Size: 8 << 30, PublishDate: time.Now().Add(-time.Hour), Categories: []int{2040},
	}, []byte("<nzb>"+name+"</nzb>"))
	if err != nil {
		k.t.Fatal(err)
	}
}

func (k *kestrel) pass(loop string) {
	k.t.Helper()
	if err := k.app.Jobs.Pass(context.Background(), loop); err != nil {
		k.t.Fatalf("%s pass: %v", loop, err)
	}
}

// grabbed runs the search so the named release is sent to the download client
// and returns the client's job id for it.
func (k *kestrel) grab(release string) string {
	k.t.Helper()
	k.pass(jobs.Search)
	items, err := k.sab.List(context.Background(), k.sab.Conn(0), "")
	if err != nil {
		k.t.Fatal(err)
	}
	for _, it := range items {
		if it.Name == release {
			return it.ClientID
		}
	}
	k.t.Fatalf("%s was not grabbed: %+v", release, items)
	return ""
}

// moreMovies adds a second Movies root folder next to the default pair and
// returns its path.
func (k *kestrel) moreMovies() string {
	k.t.Helper()
	more := filepath.Join(k.Data, "media", "more-movies")
	for _, d := range []string{filepath.Join(k.Data, "media", "movies"), filepath.Join(k.Data, "media", "tv"), more} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			k.t.Fatal(err)
		}
	}
	body := fmt.Sprintf(`{"root_folders":{"movies":[%q,%q],"series":[%q]}}`,
		filepath.Join(k.Data, "media", "movies"), more, filepath.Join(k.Data, "media", "tv"))
	req, _ := http.NewRequest("PATCH", k.URL()+"/api/v1/settings", strings.NewReader(body))
	req.Header.Set("X-Api-Key", k.Key)
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		k.t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		raw, _ := io.ReadAll(res.Body)
		k.t.Fatalf("PATCH /settings = %d %s", res.StatusCode, raw)
	}
	return more
}

// rootFolderOf reads the root folder of the Title behind a Request.
func (k *kestrel) rootFolderOf(req reqJSON) string {
	k.t.Helper()
	r, _ := http.NewRequest("GET", fmt.Sprintf("%s/api/v1/titles/%d", k.URL(), req.TitleID), nil)
	r.Header.Set("X-Api-Key", k.Key)
	res, err := http.DefaultClient.Do(r)
	if err != nil {
		k.t.Fatal(err)
	}
	defer res.Body.Close()
	var out struct {
		RootFolder string `json:"root_folder"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		k.t.Fatal(err)
	}
	return out.RootFolder
}
