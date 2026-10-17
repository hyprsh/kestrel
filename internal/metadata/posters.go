package metadata

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// ErrNoPoster means the provider has no poster for the title.
var ErrNoPoster = errors.New("metadata: no poster")

// PostersOptions configures NewPosters.
type PostersOptions struct {
	// ConfigDir is the config dir; posters live in <ConfigDir>/cache/posters.
	ConfigDir string
	// ImageBase defaults to https://image.tmdb.org/t/p.
	ImageBase string
	HTTP      *http.Client
}

// Posters caches TMDB posters on disk, one file per title.
type Posters struct {
	dir  string
	base string
	http *http.Client
}

// posterSize is the one width Kestrel caches: sharp at the detail pane's size.
const posterSize = "w342"

// NewPosters returns a poster cache.
func NewPosters(o PostersOptions) *Posters {
	if o.ImageBase == "" {
		o.ImageBase = "https://image.tmdb.org/t/p"
	}
	if o.HTTP == nil {
		o.HTTP = &http.Client{Timeout: 30 * time.Second}
	}
	return &Posters{dir: filepath.Join(o.ConfigDir, "cache", "posters"), base: strings.TrimRight(o.ImageBase, "/"), http: o.HTTP}
}

func (p *Posters) path(kind Kind, tmdbID int) string {
	return filepath.Join(p.dir, string(kind)+"-"+strconv.Itoa(tmdbID)+".jpg")
}

// Cached returns the file of a poster already on disk.
func (p *Posters) Cached(kind Kind, tmdbID int) (string, bool) {
	path := p.path(kind, tmdbID)
	if _, err := os.Stat(path); err != nil {
		return "", false
	}
	return path, true
}

// Ensure returns the poster's file, downloading it first if it is not cached.
// A blank posterPath is ErrNoPoster.
func (p *Posters) Ensure(ctx context.Context, kind Kind, tmdbID int, posterPath string) (string, error) {
	if posterPath == "" {
		return "", ErrNoPoster
	}
	if path, ok := p.Cached(kind, tmdbID); ok {
		return path, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.base+"/"+posterSize+"/"+strings.TrimLeft(posterPath, "/"), nil)
	if err != nil {
		return "", err
	}
	res, err := p.http.Do(req)
	if err != nil {
		return "", &Error{Code: CodeUnavailable, Message: "fetching the poster: " + err.Error()}
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", &Error{Code: CodeUnavailable, Message: fmt.Sprintf("poster request answered %d", res.StatusCode)}
	}
	if err := os.MkdirAll(p.dir, 0o755); err != nil {
		return "", err
	}
	// Write beside the target and rename, so a half-written poster is never served.
	tmp, err := os.CreateTemp(p.dir, "poster-*.partial")
	if err != nil {
		return "", err
	}
	defer os.Remove(tmp.Name())
	if _, err := io.Copy(tmp, res.Body); err != nil {
		tmp.Close()
		return "", &Error{Code: CodeUnavailable, Message: "fetching the poster: " + err.Error()}
	}
	if err := tmp.Close(); err != nil {
		return "", err
	}
	path := p.path(kind, tmdbID)
	if err := os.Rename(tmp.Name(), path); err != nil {
		return "", err
	}
	return path, nil
}
