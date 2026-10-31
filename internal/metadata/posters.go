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
	// Clock defaults to time.Now.
	Clock func() time.Time
}

// Posters caches TMDB posters on disk, one file per title.
type Posters struct {
	dir  string
	base string
	http *http.Client
	now  func() time.Time
}

const (
	// posterMaxAge is how old a poster gets before Ensure downloads it again.
	posterMaxAge = 30 * 24 * time.Hour
	// posterKeepLimit is the longest a poster may be kept: TMDB's terms forbid
	// caching its content for more than six months. Past it a poster is never
	// served and the sweep deletes it.
	posterKeepLimit = 180 * 24 * time.Hour
)

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
	if o.Clock == nil {
		o.Clock = time.Now
	}
	return &Posters{dir: filepath.Join(o.ConfigDir, "cache", "posters"), base: strings.TrimRight(o.ImageBase, "/"), http: o.HTTP, now: o.Clock}
}

func (p *Posters) path(kind Kind, tmdbID int) string {
	return filepath.Join(p.dir, string(kind)+"-"+strconv.Itoa(tmdbID)+".jpg")
}

// sourcePath is the sidecar holding the poster_path the file was fetched from.
func (p *Posters) sourcePath(kind Kind, tmdbID int) string {
	return strings.TrimSuffix(p.path(kind, tmdbID), ".jpg") + ".src"
}

// age is how old the cached poster is.
func (p *Posters) age(kind Kind, tmdbID int) (time.Duration, bool) {
	info, err := os.Stat(p.path(kind, tmdbID))
	if err != nil {
		return 0, false
	}
	return p.now().Sub(info.ModTime()), true
}

// Cached returns the file of a poster on disk that is not past the six-month
// limit. It may be stale: Ensure is what downloads it again.
func (p *Posters) Cached(kind Kind, tmdbID int) (string, bool) {
	if age, ok := p.age(kind, tmdbID); !ok || age > posterKeepLimit {
		return "", false
	}
	return p.path(kind, tmdbID), true
}

// Remove deletes a Title's cached poster, if it has one.
func (p *Posters) Remove(kind Kind, tmdbID int) {
	_ = os.Remove(p.path(kind, tmdbID))
	_ = os.Remove(p.sourcePath(kind, tmdbID))
}

// Sweep deletes every poster past the six-month limit, asked for or not.
func (p *Posters) Sweep() error {
	entries, err := os.ReadDir(p.dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, e := range entries {
		info, err := e.Info()
		if err != nil || p.now().Sub(info.ModTime()) <= posterKeepLimit {
			continue
		}
		if err := os.Remove(filepath.Join(p.dir, e.Name())); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}

// Ensure returns the poster's file. A poster is downloaded when it is not
// cached, is older than 30 days or came from another posterPath. If that
// download fails, a stale poster is still served unless it is past six
// months. A blank posterPath is ErrNoPoster.
func (p *Posters) Ensure(ctx context.Context, kind Kind, tmdbID int, posterPath string) (string, error) {
	if posterPath == "" {
		return "", ErrNoPoster
	}
	age, onDisk := p.age(kind, tmdbID)
	if onDisk && age > posterKeepLimit {
		p.Remove(kind, tmdbID)
		onDisk = false
	}
	if onDisk {
		src, _ := os.ReadFile(p.sourcePath(kind, tmdbID))
		if age <= posterMaxAge && string(src) == posterPath {
			return p.path(kind, tmdbID), nil
		}
	}
	path, err := p.download(ctx, kind, tmdbID, posterPath)
	if err != nil && onDisk {
		return p.path(kind, tmdbID), nil
	}
	return path, err
}

func (p *Posters) download(ctx context.Context, kind Kind, tmdbID int, posterPath string) (string, error) {
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
	if err := os.Chtimes(tmp.Name(), p.now(), p.now()); err != nil {
		return "", err
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		return "", err
	}
	// The sidecar comes last: it never names an image that is not stored.
	if err := os.WriteFile(p.sourcePath(kind, tmdbID), []byte(posterPath), 0o644); err != nil {
		return "", err
	}
	return path, nil
}
