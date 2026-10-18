package api_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/app"
	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
	"github.com/hyprsh/kestrel/internal/probe"
)

// pathProber answers by file path: "broken" is unreadable, "uhd" is 2160p,
// "short" is ten minutes long, everything else is a good 1080p file.
type pathProber struct{}

func (pathProber) Probe(_ context.Context, path string) (probe.Info, error) {
	switch {
	case strings.Contains(path, "broken"):
		return probe.Info{}, errors.New("unreadable")
	case strings.Contains(path, "uhd"):
		i := goodProbe()
		i.Width, i.Height = 3840, 2160
		return i, nil
	case strings.Contains(path, "576p"):
		i := goodProbe()
		i.Width, i.Height = 1024, 576
		return i, nil
	case strings.Contains(path, "french"):
		i := goodProbe()
		i.Audio = []probe.AudioTrack{{Index: 1, Codec: "eac3", Channels: 6, Language: "fra", Default: true}}
		return i, nil
	case strings.Contains(path, "short"):
		i := goodProbe()
		i.Duration = 10 * time.Minute
		return i, nil
	case strings.Contains(path, "small"):
		i := goodProbe()
		i.Size = 1 << 30
		return i, nil
	}
	return goodProbe(), nil
}

type adoptionRowJSON struct {
	ID         int64   `json:"id"`
	Status     string  `json:"status"`
	SkipReason *string `json:"skip_reason"`
	Entry      string  `json:"entry"`
	Ticked     bool    `json:"ticked"`
	Match      *struct {
		TMDBID  int    `json:"tmdb_id"`
		Title   string `json:"title"`
		TitleID *int64 `json:"title_id"`
		Source  string `json:"source"`
		Folder  string `json:"folder"`
	} `json:"match"`
	Candidates []struct {
		TMDBID int    `json:"tmdb_id"`
		Title  string `json:"title"`
	} `json:"candidates"`
	Kind  string             `json:"kind"`
	Files []adoptionFileJSON `json:"files"`
}

type adoptionFileJSON struct {
	Path      string  `json:"path"`
	To        string  `json:"to"`
	Slot      string  `json:"slot"`
	Profile   string  `json:"profile"`
	Score     int     `json:"score"`
	Action    string  `json:"action"`
	HeldScore *int    `json:"held_score"`
	Ticked    bool    `json:"ticked"`
	Left      *string `json:"left"`
	Episodes  []struct {
		Season int `json:"season"`
		Number int `json:"number"`
	} `json:"episodes"`
	Subtitles []struct {
		From string `json:"from"`
		To   string `json:"to"`
	} `json:"subtitles"`
}

type adoptionJSON struct {
	State    string  `json:"state"`
	Revision int64   `json:"revision"`
	Error    *string `json:"error"`
	Summary  struct {
		Matched     int `json:"matched"`
		NeedsChoice int `json:"needs_choice"`
		Skipped     int `json:"skipped"`
		Duplicate   int `json:"duplicate"`
		Replacement int `json:"replacement"`
	} `json:"summary"`
	Result *struct {
		Adopted  int     `json:"adopted"`
		Failed   int     `json:"failed"`
		TitleIDs []int64 `json:"title_ids"`
	} `json:"result"`
}

// adopting is Kestrel with the fake TMDB and a Movie root folder to scan.
type adopting struct {
	library
	movies string
	tv     string
}

func newAdopting(t *testing.T, with ...func(*app.Options)) adopting {
	t.Helper()
	tmdb := metadatatest.New(t)
	tvdb := metadatatest.NewTVDB(t)
	data, config := t.TempDir(), t.TempDir()
	in := newInstance(t, "", append([]func(*app.Options){func(o *app.Options) {
		o.DataDir, o.ConfigDir, o.Prober = data, config, pathProber{}
		o.TVDB = metadata.NewTVDB(metadata.TVDBOptions{BaseURL: tvdb.APIBase(), Keys: metadata.StaticTVDBKey(metadatatest.TVDBKey)})
		o.Metadata = metadata.NewTMDB(metadata.TMDBOptions{BaseURL: tmdb.APIBase(), ImageBase: tmdb.ImageBase(), Keys: metadata.StaticKey(metadatatest.Key)})
		o.Posters = metadata.NewPosters(metadata.PostersOptions{ConfigDir: config, ImageBase: tmdb.ImageBase()})
	}}, with...)...)
	movies := filepath.Join(data, "media", "movies")
	tv := filepath.Join(data, "media", "tv")
	for _, d := range []string{movies, tv} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	return adopting{library: library{browser: in.setUp(), tmdb: tmdb, tvdb: tvdb, config: config, data: data}, movies: movies, tv: tv}
}

// put writes a file under the movies root, making its folders.
func (a adopting) put(t *testing.T, rel, body string) string {
	t.Helper()
	p := filepath.Join(a.movies, rel)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

// putTV writes a file under the Series root folder, making its folders.
func (a adopting) putTV(t *testing.T, rel, body string) string {
	t.Helper()
	p := filepath.Join(a.tv, rel)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

// scan runs a scan to the end and returns the plan's state.
func (a adopting) scan(t *testing.T) adoptionJSON {
	t.Helper()
	if r := a.valid("POST", "/adoption/scan", ""); r.Status != 202 {
		t.Fatalf("scan = %d %s", r.Status, r.Body)
	}
	return a.settled(t, "scanning")
}

// settled waits until the plan leaves the given running state.
func (a adopting) settled(t *testing.T, running string) adoptionJSON {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for {
		got := decode[adoptionJSON](t, a.valid("GET", "/adoption", ""))
		if got.State != running {
			return got
		}
		if time.Now().After(deadline) {
			t.Fatalf("still %s: %+v", running, got)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func (a adopting) rows(t *testing.T, filter string) []adoptionRowJSON {
	t.Helper()
	path := "/adoption/rows"
	if filter != "" {
		path += "?filter=" + filter
	}
	return decode[struct {
		Items []adoptionRowJSON `json:"items"`
	}](t, a.valid("GET", path, "")).Items
}

func (a adopting) rowOf(t *testing.T, entry string) adoptionRowJSON {
	t.Helper()
	for _, r := range a.rows(t, "") {
		if filepath.Base(r.Entry) == entry {
			return r
		}
	}
	t.Fatalf("no row for %q in %+v", entry, a.rows(t, ""))
	return adoptionRowJSON{}
}

func (a adopting) commit(t *testing.T, revision int64) adoptionJSON {
	t.Helper()
	if r := a.valid("POST", "/adoption/commit", fmt.Sprintf(`{"revision":%d}`, revision)); r.Status != 202 {
		t.Fatalf("commit = %d %s", r.Status, r.Body)
	}
	return a.settled(t, "committing")
}

func TestScanningRootFoldersPlansTaggedConfidentAmbiguousAndUnreadableMovies(t *testing.T) {
	a := newAdopting(t)
	a.put(t, "The Lost Film (2020) [tmdbid-77]/lost.film.mkv", "lost")
	a.put(t, "Paddington.2014.1080p.BluRay.x264-GRP/Paddington.2014.1080p.BluRay.x264-GRP.mkv", "pad")
	a.put(t, "Paddington/pad.mkv", "ambiguous")
	a.put(t, "Broken Thing (2001)/broken.mkv", "x")

	plan := a.scan(t)

	if plan.State != "planned" || plan.Summary.Matched != 2 || plan.Summary.NeedsChoice != 1 || plan.Summary.Skipped != 1 {
		t.Fatalf("plan = %+v", plan)
	}
	tagged := a.rowOf(t, "The Lost Film (2020) [tmdbid-77]")
	if tagged.Status != "matched" || tagged.Match == nil || tagged.Match.TMDBID != 77 || tagged.Match.Source != "tag" ||
		tagged.Match.Folder != "The Lost Film (2020) {tmdb-77}" || !tagged.Ticked || len(tagged.Files) != 1 {
		t.Errorf("tagged = %+v", tagged)
	}
	named := a.rowOf(t, "Paddington.2014.1080p.BluRay.x264-GRP")
	if named.Status != "matched" || named.Match == nil || named.Match.TMDBID != 116149 || named.Match.Source != "name" {
		t.Errorf("named = %+v", named)
	}
	f := named.Files[0]
	if f.Slot != "standard" || f.Profile == "" || f.Action != "create" || f.Left != nil || !f.Ticked ||
		!strings.Contains(f.To, "/Paddington (2014) {tmdb-116149}/Paddington (2014) {tmdb-116149} - [Standard]") || !strings.HasSuffix(f.To, "-GRP.mkv") {
		t.Errorf("file = %+v", f)
	}
	ambiguous := a.rowOf(t, "Paddington")
	if ambiguous.Status != "needs_choice" || ambiguous.Match != nil || len(ambiguous.Candidates) == 0 || ambiguous.Candidates[0].TMDBID != 116149 || ambiguous.Ticked {
		t.Errorf("ambiguous = %+v", ambiguous)
	}
	broken := a.rowOf(t, "Broken Thing (2001)")
	if broken.Status != "skipped" || broken.SkipReason == nil || *broken.SkipReason != "invalid" {
		t.Errorf("broken = %+v", broken)
	}
	if got := a.rows(t, "skipped"); len(got) != 1 || got[0].Status != "skipped" {
		t.Errorf("skipped filter = %+v", got)
	}
	if got := a.rows(t, "needs_choice"); len(got) != 1 {
		t.Errorf("needs_choice filter = %+v", got)
	}
}
