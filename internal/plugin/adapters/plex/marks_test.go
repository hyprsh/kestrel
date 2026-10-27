package plex_test

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/adapters/plex"
	mediaserver "github.com/hyprsh/kestrel/internal/plugin/mediaserver/v1"
	"github.com/hyprsh/kestrel/internal/plugin/plugintest"
)

// plexMarks is a Plex server that answers from the fixtures in testdata and
// remembers what the marks calls did.
type plexMarks struct {
	mu        sync.Mutex
	labels    map[string][]string // by ratingKey
	calls     []string            // "METHOD path?query"
	uploaded  []byte
	selected  string // the selected poster key of item 101
	posters   []string
	collected []string // titles created
}

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func marksServer(t *testing.T) (*httptest.Server, *plexMarks) {
	t.Helper()
	files := map[string][]byte{}
	for _, n := range []string{"sections.json", "identity.json", "movies_all.json", "shows_all.json", "labels.json", "collections.json"} {
		files[n] = fixture(t, n)
	}
	m := &plexMarks{labels: map[string][]string{"101": {"Family"}}, selected: "metadata://posters/tmdb_dune",
		posters: []string{"metadata://posters/tmdb_dune", "upload://posters/old"}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Plex-Token") != token {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		m.mu.Lock()
		defer m.mu.Unlock()
		if r.Method != http.MethodGet {
			m.calls = append(m.calls, r.Method+" "+r.URL.Path+"?"+r.URL.Query().Encode())
		}
		send := func(name string) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(files[name])
		}
		p := r.URL.Path
		switch {
		case p == "/":
			send("identity.json")
		case p == "/library/sections":
			send("sections.json")
		case p == "/library/sections/1/all" && r.Method == http.MethodGet:
			send("movies_all.json")
		case p == "/library/sections/2/all" && r.Method == http.MethodGet:
			send("shows_all.json")
		case strings.HasPrefix(p, "/library/sections/") && strings.HasSuffix(p, "/all") && r.Method == http.MethodPut:
			m.editLabels(r.URL.Query())
		case strings.HasSuffix(p, "/label"):
			send("labels.json")
		case strings.HasSuffix(p, "/collections"):
			send("collections.json")
		case p == "/library/collections" && r.Method == http.MethodPost:
			m.collected = append(m.collected, r.URL.Query().Get("title"))
		case strings.HasPrefix(p, "/library/collections/"):
			// recorded above
		case strings.HasSuffix(p, "/thumb/1700000000"):
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(pngBytes)
		case strings.HasSuffix(p, "/posters") && r.Method == http.MethodPost:
			m.uploaded, _ = io.ReadAll(r.Body)
			m.posters = append(m.posters, "upload://posters/badge")
			m.selected = "upload://posters/badge"
		case strings.HasSuffix(p, "/posters"):
			var ms []map[string]any
			for _, k := range m.posters {
				ms = append(ms, map[string]any{"ratingKey": k, "selected": k == m.selected})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"MediaContainer": map[string]any{"Metadata": ms}})
		case strings.HasSuffix(p, "/poster") && r.Method == http.MethodPut:
			m.selected = r.URL.Query().Get("url")
		case strings.HasPrefix(p, "/library/metadata/"):
			id := strings.TrimPrefix(p, "/library/metadata/")
			if id == "999" {
				http.NotFound(w, r)
				return
			}
			var ls []map[string]string
			for _, l := range m.labels[id] {
				ls = append(ls, map[string]string{"tag": l})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"MediaContainer": map[string]any{"Metadata": []map[string]any{
				{"ratingKey": id, "thumb": "/library/metadata/" + id + "/thumb/1700000000", "Label": ls},
			}}})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, m
}

// editLabels mimics Plex: label[n].tag.tag replaces the list, label[].tag.tag- removes one.
func (m *plexMarks) editLabels(q url.Values) {
	id := q.Get("id")
	if rm := q.Get("label[].tag.tag-"); rm != "" {
		m.labels[id] = slices.DeleteFunc(m.labels[id], func(l string) bool { return l == rm })
		return
	}
	var next []string
	for i := 0; ; i++ {
		l := q.Get("label[" + string(rune('0'+i)) + "].tag.tag")
		if l == "" {
			break
		}
		next = append(next, l)
	}
	m.labels[id] = next
}

var pngBytes = []byte("\x89PNG\r\n\x1a\nfixture")

func TestFindsAMovieByItsFolderAndASeriesByItsLocation(t *testing.T) {
	srv, _ := marksServer(t)
	got, err := plex.New(nil).FindItems(t.Context(), conn(srv.URL, token), []mediaserver.ItemRef{
		{Kind: mediaserver.KindMovie, Path: "/data/media/movies/Dune (2021) {tmdb-438631}", TMDBID: 438631},
		{Kind: mediaserver.KindSeries, Path: "/data/media/anime/Frieren {tvdb-424536}", TVDBID: 424536},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []mediaserver.FoundItem{
		{Ref: 0, Item: mediaserver.Item{ID: "101", SectionKey: "1", Kind: mediaserver.KindMovie}},
		{Ref: 1, Item: mediaserver.Item{ID: "201", SectionKey: "2", Kind: mediaserver.KindSeries}},
	}
	if !slices.Equal(got, want) {
		t.Fatalf("got %+v", got)
	}
}

func TestFallsBackToTheGuidWhenPlexSeesAnotherMount(t *testing.T) {
	srv, _ := marksServer(t)
	got, err := plex.New(nil).FindItems(t.Context(), conn(srv.URL, token), []mediaserver.ItemRef{
		{Kind: mediaserver.KindMovie, Path: "/data/media/movies/Arrival (2016) {tmdb-329865}", TMDBID: 329865},
		{Kind: mediaserver.KindSeries, Path: "/data/media/tv/Severance {tvdb-371980}", TVDBID: 371980},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Item.ID != "102" || got[1].Item.ID != "202" {
		t.Fatalf("got %+v", got)
	}
}

func TestATitleThePlexLibraryDoesNotListYetIsLeftOut(t *testing.T) {
	srv, _ := marksServer(t)
	got, err := plex.New(nil).FindItems(t.Context(), conn(srv.URL, token), []mediaserver.ItemRef{
		{Kind: mediaserver.KindMovie, Path: "/data/media/movies/Tenet (2020) {tmdb-577922}", TMDBID: 577922},
		{Kind: mediaserver.KindMovie, Path: "/data/media/movies/Dune Part Two (2024)", TMDBID: 693134},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Ref != 1 || got[0].Item.ID != "103" {
		t.Fatalf("got %+v", got)
	}
}

func TestAMoviesGuidDoesNotMatchASeries(t *testing.T) {
	srv, _ := marksServer(t)
	got, err := plex.New(nil).FindItems(t.Context(), conn(srv.URL, token), []mediaserver.ItemRef{
		{Kind: mediaserver.KindSeries, Path: "/nope", TVDBID: 438631},
	})
	if err != nil || len(got) != 0 {
		t.Fatalf("got %+v, %v", got, err)
	}
}

var dune = mediaserver.Item{ID: "101", SectionKey: "1", Kind: mediaserver.KindMovie}

func TestAddingLabelsKeepsTheOnesTheItemHad(t *testing.T) {
	srv, m := marksServer(t)
	c := plex.New(nil)
	added, err := c.AddLabels(t.Context(), conn(srv.URL, token), dune, []string{"Requested", "Requested by ellie", "family"})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(added, []string{"Requested", "Requested by ellie"}) {
		t.Fatalf("added %v", added)
	}
	if !slices.Equal(m.labels["101"], []string{"Family", "Requested", "Requested by ellie"}) {
		t.Fatalf("labels %v", m.labels["101"])
	}
	again, err := c.AddLabels(t.Context(), conn(srv.URL, token), dune, []string{"Requested"})
	if err != nil || len(again) != 0 {
		t.Fatalf("again %v %v", again, err)
	}
}

func TestRemovingLabelsTakesOffOnlyTheNamedOnes(t *testing.T) {
	srv, m := marksServer(t)
	c := plex.New(nil)
	if _, err := c.AddLabels(t.Context(), conn(srv.URL, token), dune, []string{"Requested"}); err != nil {
		t.Fatal(err)
	}
	if err := c.RemoveLabels(t.Context(), conn(srv.URL, token), dune, []string{"Requested", "Never had"}); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(m.labels["101"], []string{"Family"}) {
		t.Fatalf("labels %v", m.labels["101"])
	}
}

func TestAnItemPlexNoLongerHasIsNotFound(t *testing.T) {
	srv, _ := marksServer(t)
	_, err := plex.New(nil).AddLabels(t.Context(), conn(srv.URL, token), mediaserver.Item{ID: "999", SectionKey: "1", Kind: mediaserver.KindMovie}, []string{"Requested"})
	var pe *plugin.Error
	if !errors.As(err, &pe) || pe.Code != plugin.CodeNotFound {
		t.Fatalf("err %v", err)
	}
}

func TestAnExistingSmartCollectionOnTheLabelIsLeftAlone(t *testing.T) {
	srv, m := marksServer(t)
	if err := plex.New(nil).EnsureCollection(t.Context(), conn(srv.URL, token), "1", "Requested", "Requested"); err != nil {
		t.Fatal(err)
	}
	if len(m.calls) != 0 {
		t.Fatalf("calls %v", m.calls)
	}
}

func TestACollectionIsCreatedAsASmartCollectionOnTheLabelsId(t *testing.T) {
	srv, m := marksServer(t)
	// section 2 has no collection of the name in the fixture only because the server shares it; ask for another name
	if err := plex.New(nil).EnsureCollection(t.Context(), conn(srv.URL, token), "2", "Wanted", "Requested"); err != nil {
		t.Fatal(err)
	}
	if len(m.calls) != 1 || !strings.HasPrefix(m.calls[0], "POST /library/collections?") {
		t.Fatalf("calls %v", m.calls)
	}
	q, _ := url.ParseQuery(strings.SplitN(m.calls[0], "?", 2)[1])
	wantURI := "server://0123456789abcdef0123456789abcdef01234567/com.plexapp.plugins.library/library/sections/2/all?type=2&label=12"
	if q.Get("smart") != "1" || q.Get("type") != "2" || q.Get("sectionId") != "2" || q.Get("title") != "Wanted" || q.Get("uri") != wantURI {
		t.Fatalf("query %v", q)
	}
}

func TestRemovingTheCollectionDeletesOnlyTheSmartOneOnTheLabel(t *testing.T) {
	srv, m := marksServer(t)
	if err := plex.New(nil).RemoveCollection(t.Context(), conn(srv.URL, token), "1", "Requested", "Requested"); err != nil {
		t.Fatal(err)
	}
	if len(m.calls) != 1 || !strings.HasPrefix(m.calls[0], "DELETE /library/collections/901?") {
		t.Fatalf("calls %v", m.calls)
	}
}

func TestPostersListTheSelectedOneAndRestoreSelectsByKey(t *testing.T) {
	srv, m := marksServer(t)
	c := plex.New(nil)
	cn := conn(srv.URL, token)
	ps, err := c.Posters(t.Context(), cn, dune)
	if err != nil {
		t.Fatal(err)
	}
	if len(ps) != 2 || !ps[0].Selected || ps[0].Key != "metadata://posters/tmdb_dune" || ps[1].Selected {
		t.Fatalf("posters %+v", ps)
	}
	img, err := c.PosterImage(t.Context(), cn, dune)
	if err != nil || string(img.Data) != string(pngBytes) {
		t.Fatalf("image %q %v", img.Data, err)
	}
	up, err := c.UploadPoster(t.Context(), cn, dune, mediaserver.Image{ContentType: "image/jpeg", Data: []byte("badge")})
	if err != nil {
		t.Fatal(err)
	}
	if up.Key != "upload://posters/badge" || !up.Selected || string(m.uploaded) != "badge" {
		t.Fatalf("upload %+v %q", up, m.uploaded)
	}
	if err := c.SelectPoster(t.Context(), cn, dune, ps[0].Key); err != nil {
		t.Fatal(err)
	}
	if m.selected != "metadata://posters/tmdb_dune" {
		t.Fatalf("selected %q", m.selected)
	}
}

func TestTheMarksTypesAreData(t *testing.T) {
	plugintest.RoundTrip[mediaserver.ItemRef](t)
	plugintest.RoundTrip[mediaserver.Item](t)
	plugintest.RoundTrip[mediaserver.FoundItem](t)
	plugintest.RoundTrip[mediaserver.Poster](t)
	plugintest.RoundTrip[mediaserver.Image](t)
}
