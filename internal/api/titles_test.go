package api_test

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/app"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
)

type slotJSON struct {
	VersionID   int64  `json:"version_id"`
	Profile     string `json:"profile"`
	State       string `json:"state"`
	LongMissing bool   `json:"long_missing"`
}

type rowJSON struct {
	ID           int64  `json:"id"`
	Kind         string `json:"kind"`
	Title        string `json:"title"`
	PrimaryTitle string `json:"primary_title"`
	Year         *int   `json:"year"`
	HasPoster    bool   `json:"has_poster"`
	Slots        struct {
		Standard *slotJSON `json:"standard"`
		FourK    *slotJSON `json:"4k"`
	} `json:"slots"`
	WantedSince *time.Time `json:"wanted_since"`
}

type titleJSON struct {
	ID               int64   `json:"id"`
	Kind             string  `json:"kind"`
	TMDBID           *int    `json:"tmdb_id"`
	IMDbID           *string `json:"imdb_id"`
	Title            string  `json:"title"`
	OriginalTitle    string  `json:"original_title"`
	PrimaryTitle     string  `json:"primary_title"`
	Year             *int    `json:"year"`
	OriginalLanguage string  `json:"original_language"`
	Runtime          *int    `json:"runtime"`
	HasPoster        bool    `json:"has_poster"`
	Monitored        bool    `json:"monitored"`
	RootFolder       string  `json:"root_folder"`
	Certification    *string `json:"certification"`
	ReleaseDates     []struct {
		Country string `json:"country"`
		Type    string `json:"type"`
	} `json:"release_dates"`
	Versions []struct {
		ID          int64   `json:"id"`
		Slot        string  `json:"slot"`
		Profile     string  `json:"profile"`
		State       string  `json:"state"`
		WantedSince *string `json:"wanted_since"`
		File        any     `json:"file"`
	} `json:"versions"`
}

type lookupJSON struct {
	Items []struct {
		Kind      string  `json:"kind"`
		TMDBID    int     `json:"tmdb_id"`
		Title     string  `json:"title"`
		Year      *int    `json:"year"`
		Poster    *string `json:"poster"`
		InLibrary *int64  `json:"in_library"`
		Addable   bool    `json:"addable"`
	} `json:"items"`
}

type suggestionJSON struct {
	Title                string  `json:"title"`
	Certification        *string `json:"certification"`
	CertificationCountry *string `json:"certification_country"`
	InLibrary            *int64  `json:"in_library"`
	Slots                []struct {
		Slot    string `json:"slot"`
		Profile string `json:"profile"`
		Label   string `json:"label"`
		Reason  string `json:"reason"`
	} `json:"slots"`
}

type library struct {
	*browser
	tmdb   *metadatatest.Server
	tvdb   *metadatatest.TVDBServer
	config string
	data   string
}

// newLibraryInstance is Kestrel wired to the fake TMDB, with the default Root folders in place.
func newLibraryInstance(t *testing.T, key string) library {
	t.Helper()
	tmdb := metadatatest.New(t)
	tvdb := metadatatest.NewTVDB(t)
	data, config := t.TempDir(), t.TempDir()
	in := newInstance(t, "", func(o *app.Options) {
		o.DataDir, o.ConfigDir = data, config
		o.Metadata = metadata.NewTMDB(metadata.TMDBOptions{BaseURL: tmdb.APIBase(), ImageBase: tmdb.ImageBase(), Keys: metadata.StaticKey(key)})
		o.TVDB = metadata.NewTVDB(metadata.TVDBOptions{BaseURL: tvdb.APIBase(), Keys: metadata.StaticTVDBKey(metadatatest.TVDBKey)})
		o.Posters = metadata.NewPosters(metadata.PostersOptions{ConfigDir: config, ImageBase: tmdb.ImageBase()})
	})
	return library{browser: in.setUp(), tmdb: tmdb, tvdb: tvdb, config: config, data: data}
}

// moreFolders saves the default Root folders plus a second one per kind, and returns those two.
func (l library) moreFolders(t *testing.T) (movies, series string) {
	t.Helper()
	movies, series = l.data+"/media/more-movies", l.data+"/media/more-tv"
	mkdirs(t, l.data+"/media/movies", l.data+"/media/tv", movies, series)
	l.valid("PATCH", "/settings", fmt.Sprintf(`{"root_folders":{"movies":[%q,%q],"series":[%q,%q]}}`,
		l.data+"/media/movies", movies, l.data+"/media/tv", series))
	return movies, series
}

func (l library) rootFolderOf(t *testing.T, r reply) string {
	t.Helper()
	req := decode[requestJSON](t, r)
	if req.Outcome != "accepted" || req.TitleID == nil {
		t.Fatalf("request = %+v", req)
	}
	return decode[titleJSON](t, l.valid("GET", fmt.Sprintf("/titles/%d", *req.TitleID), "")).RootFolder
}

const addPaddington = `{"kind":"movie","tmdb_id":116149,"versions":[{"slot":"standard","profile":"hd-primary"},{"slot":"4k","profile":"4k-primary"}]}`

func TestAMovieIsAddedThroughTheAPIAndReadBackWithItsVersions(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)

	r := l.valid("POST", "/titles", addPaddington)
	if r.Status != 201 {
		t.Fatalf("POST /titles = %d %s", r.Status, r.Body)
	}
	created := decode[titleJSON](t, r)

	got := decode[titleJSON](t, l.valid("GET", fmt.Sprintf("/titles/%d", created.ID), ""))
	if got.Kind != "movie" || got.Title != "Paddington" || got.OriginalTitle != "Paddington" || got.OriginalLanguage != "en" ||
		got.TMDBID == nil || *got.TMDBID != 116149 || got.IMDbID == nil || *got.IMDbID != "tt1109624" ||
		got.Year == nil || *got.Year != 2014 || got.Runtime == nil || *got.Runtime != 95 || !got.Monitored {
		t.Errorf("title = %+v", got)
	}
	if got.RootFolder != l.data+"/media/movies" {
		t.Errorf("root folder = %q, want the first configured one", got.RootFolder)
	}
	if got.Certification == nil || *got.Certification != "PG" {
		t.Errorf("certification = %v (US household, US rating)", got.Certification)
	}
	if len(got.ReleaseDates) != 9 {
		t.Errorf("%d release dates stored, want every type of every country", len(got.ReleaseDates))
	}
	if len(got.Versions) != 2 || got.Versions[0].Slot != "standard" || got.Versions[0].Profile != "hd-primary" || got.Versions[0].State != "wanted" ||
		got.Versions[1].Slot != "4k" || got.Versions[1].Profile != "4k-primary" || got.Versions[0].File != nil {
		t.Errorf("versions = %+v", got.Versions)
	}

	list := decode[struct {
		Items []rowJSON `json:"items"`
	}](t, l.valid("GET", "/titles?limit=10000", ""))
	if len(list.Items) != 1 {
		t.Fatalf("list = %+v", list.Items)
	}
	row := list.Items[0]
	if row.ID != created.ID || row.Title != "Paddington" || row.Slots.Standard == nil || row.Slots.Standard.State != "wanted" ||
		row.Slots.FourK == nil || row.Slots.FourK.Profile != "4k-primary" || row.WantedSince == nil {
		t.Errorf("row = %+v", row)
	}
}

func TestThePrimaryLanguageTitleIsStoredWhenTMDBHasATranslation(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	l.valid("PATCH", "/settings", `{"language_region":{"primary_language":"de"}}`)
	l.trashPass(t)
	got := decode[titleJSON](t, l.valid("POST", "/titles", addPaddington))
	if got.PrimaryTitle != "Ein Bär namens Paddington" || got.Title != "Paddington" {
		t.Errorf("titles = %q / %q", got.Title, got.PrimaryTitle)
	}
	// A German household reads the German release dates: released 2015-01-22.
	if got.Versions[0].State != "wanted" {
		t.Errorf("state = %s", got.Versions[0].State)
	}
}

func TestLookupSearchesBothKinds(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	got := decode[lookupJSON](t, l.valid("GET", "/lookup?q=paddington", ""))
	if len(got.Items) != 2 {
		t.Fatalf("items = %+v", got.Items)
	}
	m := got.Items[0]
	if m.Kind != "movie" || m.TMDBID != 116149 || m.Title != "Paddington" || m.Year == nil || *m.Year != 2014 || !m.Addable || m.InLibrary != nil {
		t.Errorf("movie = %+v", m)
	}
	if m.Poster == nil || !strings.HasSuffix(*m.Poster, "/pyFVnLq1sG1jdXZQhxNdCP0DLg3.jpg") {
		t.Errorf("poster = %v", m.Poster)
	}
	if none := decode[lookupJSON](t, l.valid("GET", "/lookup?q=casablanca", "")); len(none.Items) != 0 {
		t.Errorf("a miss = %+v", none.Items)
	}
	if series := decode[lookupJSON](t, l.valid("GET", "/lookup?q=paddington&kind=series", "")); len(series.Items) != 1 || series.Items[0].Kind != "series" || series.Items[0].Addable {
		t.Errorf("the one Series TMDB lists has no TheTVDB id, so it is offered greyed out: %+v", series.Items)
	}
	if r := l.do("GET", "/lookup?q=", ""); r.Status != 422 && r.Status != 400 {
		t.Errorf("empty query = %d %s", r.Status, r.Body)
	}
}

func TestLookupMarksTitlesAlreadyInTheLibrary(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	id := decode[titleJSON](t, l.valid("POST", "/titles", addPaddington)).ID

	got := decode[lookupJSON](t, l.valid("GET", "/lookup?q=paddington&kind=movie", ""))
	if len(got.Items) != 1 || got.Items[0].InLibrary == nil || *got.Items[0].InLibrary != id {
		t.Errorf("items = %+v", got.Items)
	}
	sug := decode[suggestionJSON](t, l.valid("GET", "/lookup/movie/116149", ""))
	if sug.InLibrary == nil || *sug.InLibrary != id {
		t.Errorf("suggestion in_library = %v", sug.InLibrary)
	}
}

func TestTheSuggestionPreselectsTheSlotDefaultsWhateverTheRating(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)

	// US household: Paddington is PG, and still gets HD.
	sug := decode[suggestionJSON](t, l.valid("GET", "/lookup/movie/116149", ""))
	if len(sug.Slots) != 1 || sug.Slots[0].Slot != "standard" || sug.Slots[0].Profile != "hd-primary" ||
		sug.Slots[0].Label != "HD" || sug.Slots[0].Reason != "default" {
		t.Errorf("US = %+v", sug.Slots)
	}
	if sug.Certification == nil || *sug.Certification != "PG" || sug.CertificationCountry == nil || *sug.CertificationCountry != "US" {
		t.Errorf("rating = %v %v", sug.Certification, sug.CertificationCountry)
	}

	// German household reads the FSK rating.
	l.valid("PATCH", "/settings", `{"language_region":{"primary_language":"de"}}`)
	l.trashPass(t)
	sug = decode[suggestionJSON](t, l.valid("GET", "/lookup/movie/116149", ""))
	if sug.Slots[0].Profile != "hd-primary" || sug.Slots[0].Label != "HD" || sug.Slots[0].Reason != "default" || *sug.CertificationCountry != "DE" {
		t.Errorf("DE = %+v", sug.Slots)
	}

	// An adult title gets the same.
	l.valid("PATCH", "/settings", `{"language_region":{"primary_language":"en"}}`)
	l.trashPass(t)
	sug = decode[suggestionJSON](t, l.valid("GET", "/lookup/movie/77", ""))
	if sug.Slots[0].Profile != "hd-primary" {
		t.Errorf("PG-13 = %+v", sug.Slots)
	}

	// Slots with a default join in.
	l.valid("PATCH", "/profiles/4k-primary", `{"default_movies":true}`)
	sug = decode[suggestionJSON](t, l.valid("GET", "/lookup/movie/77", ""))
	if len(sug.Slots) != 2 || sug.Slots[1].Slot != "4k" || sug.Slots[1].Profile != "4k-primary" {
		t.Errorf("with a 4K default = %+v", sug.Slots)
	}
}

func TestAddingIsRefusedForBadChoices(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	body := func(versions, extra string) string {
		return `{"kind":"movie","tmdb_id":116149,"versions":` + versions + extra + `}`
	}
	for _, c := range []struct {
		name, body, field string
	}{
		{"no versions", body(`[]`, ""), "versions"},
		{"a Profile of another Slot", body(`[{"slot":"standard","profile":"4k-primary"}]`, ""), "versions[0].profile"},
		{"the retired SD Slot", body(`[{"slot":"sd","profile":"hd-primary"}]`, ""), "versions[0].slot"},
		{"the retired HD Slot", body(`[{"slot":"hd","profile":"hd-primary"}]`, ""), "versions[0].slot"},
		{"the retired UHD Slot", body(`[{"slot":"uhd","profile":"4k-primary"}]`, ""), "versions[0].slot"},
		{"an unknown Profile", body(`[{"slot":"standard","profile":"nope"}]`, ""), "versions[0].profile"},
		{"a Slot twice", body(`[{"slot":"standard","profile":"hd-primary"},{"slot":"standard","profile":"any-primary"}]`, ""), "versions[1].slot"},
		{"a root folder that is not configured", body(`[{"slot":"standard","profile":"hd-primary"}]`, `,"root_folder":"/elsewhere"`), "root_folder"},
	} {
		r := l.do("POST", "/titles", c.body)
		if r.Status != 422 || !strings.Contains(r.Body, `"field":"`+c.field+`"`) {
			t.Errorf("%s = %d %s, want 422 on %s", c.name, r.Status, r.Body, c.field)
		}
	}

	// A disabled Profile is no choice either.
	l.valid("PATCH", "/profiles/hd-original", `{"enabled":false}`)
	if r := l.do("POST", "/titles", body(`[{"slot":"standard","profile":"hd-original"}]`, "")); r.Status != 422 {
		t.Errorf("disabled Profile = %d %s", r.Status, r.Body)
	}
	if list := decode[struct{ Items []rowJSON }](t, l.valid("GET", "/titles", "")); len(list.Items) != 0 {
		t.Errorf("refused adds left %d titles", len(list.Items))
	}
}

func TestAddingTheSameMovieTwiceIsAConflict(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	id := decode[titleJSON](t, l.valid("POST", "/titles", addPaddington)).ID
	r := l.do("POST", "/titles", addPaddington)
	if r.Status != 409 || !strings.Contains(r.Body, `"code":"conflict"`) || !strings.Contains(r.Body, fmt.Sprint(id)) {
		t.Errorf("second add = %d %s", r.Status, r.Body)
	}
}

func TestAMovieTMDBDoesNotKnowIsNotFound(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	if r := l.valid("POST", "/titles", `{"kind":"movie","tmdb_id":424242,"versions":[{"slot":"standard","profile":"hd-primary"}]}`); r.Status != 404 {
		t.Errorf("add = %d %s", r.Status, r.Body)
	}
	if r := l.valid("GET", "/lookup/movie/424242", ""); r.Status != 404 {
		t.Errorf("suggestion = %d %s", r.Status, r.Body)
	}
	if r := l.valid("GET", "/titles/99", ""); r.Status != 404 {
		t.Errorf("unknown title = %d %s", r.Status, r.Body)
	}
}

func TestWithoutAWorkingKeyTheProviderIsUnavailable(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, "")
	for _, path := range []string{"/lookup?q=paddington", "/lookup/movie/116149"} {
		r := l.valid("GET", path, "")
		if r.Status != 502 || !strings.Contains(r.Body, `"code":"upstream_unavailable"`) {
			t.Errorf("GET %s = %d %s", path, r.Status, r.Body)
		}
	}
	if r := l.valid("POST", "/titles", addPaddington); r.Status != 502 {
		t.Errorf("add = %d %s", r.Status, r.Body)
	}
	if n := len(l.tmdb.Requests()); n != 0 {
		t.Errorf("%d requests went out with no key", n)
	}
}

func TestRemovingATitleDeletesItsCachedPoster(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	created := decode[titleJSON](t, l.valid("POST", "/titles", addPaddington))
	cached := l.config + "/cache/posters/movie-116149.jpg"
	if _, err := os.Stat(cached); err != nil {
		t.Fatalf("poster not cached: %v", err)
	}
	if r := l.valid("DELETE", fmt.Sprintf("/titles/%d", created.ID), ""); r.Status != 204 {
		t.Fatalf("remove = %d %s", r.Status, r.Body)
	}
	if _, err := os.Stat(cached); err == nil {
		t.Error("the poster outlived the Title")
	}
}

func TestThePosterIsCachedUnderTheConfigDirAndServed(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	created := decode[titleJSON](t, l.valid("POST", "/titles", addPaddington))
	if !created.HasPoster {
		t.Error("has_poster is false right after adding a Title with a poster")
	}
	r := l.do("GET", fmt.Sprintf("/titles/%d/poster", created.ID), "")
	if r.Status != 200 || r.Body != "poster-bytes" || r.Header.Get("Content-Type") != "image/jpeg" {
		t.Errorf("poster = %d %q %s", r.Status, r.Body, r.Header.Get("Content-Type"))
	}
	if _, err := os.Stat(l.config + "/cache/posters/movie-116149.jpg"); err != nil {
		t.Errorf("poster not under <config>/cache/posters: %v", err)
	}

	// A Title with no poster answers 404.
	noPoster := decode[titleJSON](t, l.valid("POST", "/titles", `{"kind":"movie","tmdb_id":77,"versions":[{"slot":"standard","profile":"hd-primary"}]}`))
	if noPoster.HasPoster {
		t.Error("has_poster for a Title without one")
	}
	if r := l.valid("GET", fmt.Sprintf("/titles/%d/poster", noPoster.ID), ""); r.Status != 404 {
		t.Errorf("no poster = %d %s", r.Status, r.Body)
	}

	// The Library's rows say so too, so a list of them requests only posters that exist.
	list := decode[struct {
		Items []rowJSON `json:"items"`
	}](t, l.valid("GET", "/titles?limit=10000", ""))
	has := map[int64]bool{}
	for _, row := range list.Items {
		has[row.ID] = row.HasPoster
	}
	if len(has) != 2 || !has[created.ID] || has[noPoster.ID] {
		t.Errorf("has_poster of the rows = %v, want %d true and %d false", has, created.ID, noPoster.ID)
	}
}

// The provider URLs (KESTREL_TMDB_API_URL, KESTREL_TMDB_IMAGE_URL and
// KESTREL_TVDB_API_URL) point the real clients and the poster cache at other
// servers, here the fakes, with no client injected.
func TestTheProviderURLsPointKestrelAtOtherServers(t *testing.T) {
	t.Parallel()
	tmdb := metadatatest.New(t)
	tvdb := metadatatest.NewTVDB(t)
	in := newInstance(t, "", func(o *app.Options) {
		o.DataDir, o.ConfigDir = t.TempDir(), t.TempDir()
		o.TMDBAPIKey, o.TVDBAPIKey = metadatatest.Key, metadatatest.TVDBKey
		o.TMDBAPIURL, o.TMDBImageURL, o.TVDBAPIURL = tmdb.APIBase(), tmdb.ImageBase(), tvdb.APIBase()
	})
	b := in.setUp()

	found := decode[lookupJSON](t, b.valid("GET", "/lookup?q=paddington&kind=movie", ""))
	if len(found.Items) != 1 || found.Items[0].Poster == nil || !strings.HasPrefix(*found.Items[0].Poster, tmdb.ImageBase()+"/") {
		t.Errorf("lookup = %+v", found.Items)
	}
	movie := decode[titleJSON](t, b.valid("POST", "/titles", addPaddington))
	if r := b.do("GET", fmt.Sprintf("/titles/%d/poster", movie.ID), ""); r.Status != 200 || r.Body != "poster-bytes" {
		t.Errorf("poster = %d %q", r.Status, r.Body)
	}
	if r := b.valid("POST", "/titles", addBreakingBad+`}`); r.Status != 201 {
		t.Errorf("adding a Series = %d %s", r.Status, r.Body)
	}
	if !slices.ContainsFunc(tmdb.Requests(), func(r string) bool { return strings.HasPrefix(r, "/t/p/") }) {
		t.Errorf("no poster download reached the fake TMDB: %v", tmdb.Requests())
	}
	if len(tvdb.Requests()) == 0 {
		t.Error("no request reached the fake TheTVDB")
	}
}

func TestTitleEndpointsNeedALogin(t *testing.T) {
	t.Parallel()
	in := newInstance(t, "")
	in.setUp()
	anon := in.browser()
	for _, p := range []string{"/titles", "/titles/1", "/lookup?q=x", "/lookup/movie/1", "/titles/1/poster"} {
		if r := anon.do("GET", p, ""); r.Status != 401 {
			t.Errorf("GET %s = %d", p, r.Status)
		}
	}
}

func TestTheListFiltersByKindAndText(t *testing.T) {
	t.Parallel()
	l := newLibraryInstance(t, metadatatest.Key)
	l.valid("POST", "/titles", addPaddington)
	count := func(q string) int {
		return len(decode[struct{ Items []rowJSON }](t, l.valid("GET", "/titles?"+q, "")).Items)
	}
	if count("q=padd") != 1 || count("q=zzz") != 0 || count("kind=movie") != 1 || count("kind=series") != 0 {
		t.Error("filters do not narrow the list")
	}
}

func TestAnAddGoesInTheFirstRootFolderUnlessOneIsNamed(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name, hd, root string
		second         bool
	}{
		{"default profile", "hd-primary", "", false},
		{"any profile", "any-primary", "", false},
		{"named folder", "any-primary", "second", true},
	} {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			l := newLibraryInstance(t, metadatatest.Key)
			second, _ := l.moreFolders(t)
			first := l.data + "/media/movies"
			root := ""
			if c.root == "second" {
				root = fmt.Sprintf(`,"root_folder":%q`, second)
			}
			got := decode[titleJSON](t, l.valid("POST", "/titles", fmt.Sprintf(`{"kind":"movie","tmdb_id":116149,"versions":[{"slot":"standard","profile":%q}]%s}`, c.hd, root)))
			want := first
			if c.second {
				want = second
			}
			if got.RootFolder != want {
				t.Errorf("root folder = %q, want %q", got.RootFolder, want)
			}
		})
	}
}
