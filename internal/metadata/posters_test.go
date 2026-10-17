package metadata_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

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
