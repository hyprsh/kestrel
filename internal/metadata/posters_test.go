package metadata_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
)

func TestPostersAreCachedUnderTheConfigDirAndFetchedOnce(t *testing.T) {
	ctx := context.Background()
	srv := metadatatest.New(t)
	config := t.TempDir()
	posters := metadata.NewPosters(metadata.PostersOptions{ConfigDir: config, ImageBase: srv.ImageBase()})

	if _, ok := posters.Cached(metadata.Movie, 116149); ok {
		t.Fatal("cached before anything was fetched")
	}
	path, err := posters.Ensure(ctx, metadata.Movie, 116149, "/pyFVnLq1sG1jdXZQhxNdCP0DLg3.jpg")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(path, filepath.Join(config, "cache", "posters")+string(filepath.Separator)) {
		t.Errorf("poster at %s, want under <config>/cache/posters", path)
	}
	if b, err := os.ReadFile(path); err != nil || string(b) != "poster-bytes" {
		t.Errorf("file = %q, %v", b, err)
	}
	if got, ok := posters.Cached(metadata.Movie, 116149); !ok || got != path {
		t.Errorf("Cached = %q %v", got, ok)
	}

	if _, err := posters.Ensure(ctx, metadata.Movie, 116149, "/pyFVnLq1sG1jdXZQhxNdCP0DLg3.jpg"); err != nil {
		t.Fatal(err)
	}
	if n := len(srv.Requests()); n != 1 {
		t.Errorf("%d image requests, want 1: a cached poster is not fetched again", n)
	}
	if req := srv.Requests()[0]; !strings.HasPrefix(req, "/t/p/w342/pyFVnLq1sG1jdXZQhxNdCP0DLg3.jpg") {
		t.Errorf("request %q", req)
	}
}

func TestATitleWithoutAPosterHasNone(t *testing.T) {
	srv := metadatatest.New(t)
	posters := metadata.NewPosters(metadata.PostersOptions{ConfigDir: t.TempDir(), ImageBase: srv.ImageBase()})
	if _, err := posters.Ensure(context.Background(), metadata.Movie, 77, ""); err != metadata.ErrNoPoster {
		t.Errorf("err = %v, want ErrNoPoster", err)
	}
	if n := len(srv.Requests()); n != 0 {
		t.Errorf("%d requests for a title with no poster", n)
	}
}

// posterRig is a poster cache over an image server that can be made to fail,
// with a clock the test moves.
type posterRig struct {
	posters *metadata.Posters
	hits    atomic.Int32
	fail    atomic.Bool
	now     time.Time
	dir     string
}

func newPosterRig(t *testing.T) *posterRig {
	t.Helper()
	r := &posterRig{now: time.Now(), dir: t.TempDir()}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		r.hits.Add(1)
		if r.fail.Load() {
			http.Error(w, "down", http.StatusInternalServerError)
			return
		}
		_, _ = w.Write([]byte("bytes of " + req.URL.Path))
	}))
	t.Cleanup(srv.Close)
	r.posters = metadata.NewPosters(metadata.PostersOptions{
		ConfigDir: r.dir, ImageBase: srv.URL, Clock: func() time.Time { return r.now },
	})
	return r
}

func (r *posterRig) age(d time.Duration) { r.now = r.now.Add(d) }

func (r *posterRig) files(t *testing.T) []string {
	t.Helper()
	es, _ := os.ReadDir(filepath.Join(r.dir, "cache", "posters"))
	var out []string
	for _, e := range es {
		out = append(out, e.Name())
	}
	return out
}

const posterDay = 24 * time.Hour

func TestAPosterPastItsMaxAgeIsDownloadedAgain(t *testing.T) {
	ctx := context.Background()
	r := newPosterRig(t)
	if _, err := r.posters.Ensure(ctx, metadata.Movie, 1, "/a.jpg"); err != nil {
		t.Fatal(err)
	}
	r.age(29 * posterDay)
	if _, err := r.posters.Ensure(ctx, metadata.Movie, 1, "/a.jpg"); err != nil || r.hits.Load() != 1 {
		t.Fatalf("fresh poster: err %v, %d downloads, want 1", err, r.hits.Load())
	}
	r.age(2 * posterDay)
	if _, err := r.posters.Ensure(ctx, metadata.Movie, 1, "/a.jpg"); err != nil || r.hits.Load() != 2 {
		t.Fatalf("stale poster: err %v, %d downloads, want 2", err, r.hits.Load())
	}
	r.age(29 * posterDay)
	if _, err := r.posters.Ensure(ctx, metadata.Movie, 1, "/a.jpg"); err != nil || r.hits.Load() != 2 {
		t.Errorf("a re-downloaded poster is fresh again: %d downloads, want 2", r.hits.Load())
	}
}

func TestAChangedPosterPathIsDownloadedAgain(t *testing.T) {
	ctx := context.Background()
	r := newPosterRig(t)
	path, err := r.posters.Ensure(ctx, metadata.Movie, 1, "/old.jpg")
	if err != nil {
		t.Fatal(err)
	}
	path, err = r.posters.Ensure(ctx, metadata.Movie, 1, "/new.jpg")
	if err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(path); !strings.HasSuffix(string(b), "/new.jpg") {
		t.Errorf("served %q, want the new poster", b)
	}
	if r.hits.Load() != 2 {
		t.Errorf("%d downloads, want 2", r.hits.Load())
	}
	if _, err := r.posters.Ensure(ctx, metadata.Movie, 1, "/new.jpg"); err != nil || r.hits.Load() != 2 {
		t.Errorf("same path again: err %v, %d downloads, want 2", err, r.hits.Load())
	}
}

func TestAStalePosterIsServedWhenTheDownloadFailsUntilItIsSixMonthsOld(t *testing.T) {
	ctx := context.Background()
	r := newPosterRig(t)
	want, err := r.posters.Ensure(ctx, metadata.Movie, 1, "/a.jpg")
	if err != nil {
		t.Fatal(err)
	}
	r.fail.Store(true)
	r.age(60 * posterDay)
	got, err := r.posters.Ensure(ctx, metadata.Movie, 1, "/a.jpg")
	if err != nil || got != want {
		t.Fatalf("stale poster, download down: %q, %v; want %q", got, err, want)
	}
	if _, ok := r.posters.Cached(metadata.Movie, 1); !ok {
		t.Error("Cached = false for a 60-day-old poster")
	}
	r.age(130 * posterDay) // 190 days
	if got, err := r.posters.Ensure(ctx, metadata.Movie, 1, "/a.jpg"); err == nil {
		t.Errorf("served %q past six months", got)
	}
	if _, ok := r.posters.Cached(metadata.Movie, 1); ok {
		t.Error("Cached = true for a poster past six months")
	}
}

func TestTheSweepRemovesPostersPastSixMonthsAndNoOthers(t *testing.T) {
	ctx := context.Background()
	r := newPosterRig(t)
	if _, err := r.posters.Ensure(ctx, metadata.Movie, 1, "/a.jpg"); err != nil {
		t.Fatal(err)
	}
	r.age(100 * posterDay)
	if _, err := r.posters.Ensure(ctx, metadata.Series, 2, "/b.jpg"); err != nil {
		t.Fatal(err)
	}
	r.age(100 * posterDay) // movie 1 is 200 days old, series 2 is 100
	if err := r.posters.Sweep(); err != nil {
		t.Fatal(err)
	}
	if _, ok := r.posters.Cached(metadata.Series, 2); !ok {
		t.Error("the 100-day-old poster was swept")
	}
	for _, f := range r.files(t) {
		if strings.Contains(f, "movie-1") {
			t.Errorf("%s left after the sweep", f)
		}
	}
}

func TestRemoveDeletesATitlesPoster(t *testing.T) {
	ctx := context.Background()
	r := newPosterRig(t)
	if _, err := r.posters.Ensure(ctx, metadata.Movie, 1, "/a.jpg"); err != nil {
		t.Fatal(err)
	}
	if _, err := r.posters.Ensure(ctx, metadata.Series, 1, "/b.jpg"); err != nil {
		t.Fatal(err)
	}
	r.posters.Remove(metadata.Movie, 1)
	if _, ok := r.posters.Cached(metadata.Movie, 1); ok {
		t.Error("poster still cached")
	}
	if _, ok := r.posters.Cached(metadata.Series, 1); !ok {
		t.Error("another Title's poster was removed")
	}
	for _, f := range r.files(t) {
		if strings.Contains(f, "movie-1") {
			t.Errorf("%s left behind", f)
		}
	}
}
