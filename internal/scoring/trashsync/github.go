package trashsync

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"testing/fstest"
	"time"
)

// GitHub reads TRaSH-Guides/Guides over GitHub's unauthenticated API: one call
// for the newest commit and one tarball per update, a day apart.
type GitHub struct {
	// BaseURL is the API root; empty means https://api.github.com.
	BaseURL string
	Client  *http.Client
}

func (g GitHub) base() string {
	if g.BaseURL == "" {
		return "https://api.github.com"
	}
	return strings.TrimSuffix(g.BaseURL, "/")
}

func (g GitHub) get(ctx context.Context, url string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "kestrel")
	c := g.Client
	if c == nil {
		c = &http.Client{Timeout: 2 * time.Minute}
	}
	resp, err := c.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("GET %s: %s", url, resp.Status)
	}
	return resp, nil
}

// Latest is the newest commit on master.
func (g GitHub) Latest(ctx context.Context) (Ref, error) {
	resp, err := g.get(ctx, g.base()+"/repos/TRaSH-Guides/Guides/commits/master")
	if err != nil {
		return Ref{}, err
	}
	defer resp.Body.Close()
	var c struct {
		SHA    string `json:"sha"`
		Commit struct {
			Committer struct {
				Date time.Time `json:"date"`
			} `json:"committer"`
		} `json:"commit"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&c); err != nil || c.SHA == "" {
		return Ref{}, fmt.Errorf("unreadable commit answer: %v", err)
	}
	return Ref{Commit: c.SHA, CommittedAt: c.Commit.Committer.Date}, nil
}

// maxFile bounds one extracted file, against a hostile archive.
const maxFile = 8 << 20

// Download fetches the commit's tarball and keeps docs/json/{radarr,sonarr}
// /{cf,cf-groups,quality-profiles} plus the licence, laid out as
// scoring.LoadSnapshot reads them.
func (g GitHub) Download(ctx context.Context, ref Ref) (fs.FS, error) {
	resp, err := g.get(ctx, g.base()+"/repos/TRaSH-Guides/Guides/tarball/"+ref.Commit)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	zr, err := gzip.NewReader(resp.Body)
	if err != nil {
		return nil, err
	}
	out := fstest.MapFS{
		"COMMIT":       {Data: []byte(ref.Commit + "\n")},
		"COMMITTED_AT": {Data: []byte(ref.CommittedAt.UTC().Format(time.RFC3339) + "\n")},
	}
	tr := tar.NewReader(zr)
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		if h.Typeflag != tar.TypeReg {
			continue
		}
		// Drop the TRaSH-Guides-Guides-<sha>/ directory.
		_, rel, ok := strings.Cut(h.Name, "/")
		if !ok {
			continue
		}
		dest, keep := destination(rel)
		if !keep {
			continue
		}
		b, err := io.ReadAll(io.LimitReader(tr, maxFile+1))
		if err != nil {
			return nil, err
		}
		if len(b) > maxFile {
			return nil, fmt.Errorf("%s is larger than %d bytes", rel, maxFile)
		}
		out[dest] = &fstest.MapFile{Data: b}
	}
	return out, nil
}

// destination maps an archive path to its place in the snapshot.
func destination(rel string) (string, bool) {
	if rel == "LICENSE" {
		return "LICENSE", true
	}
	rest, ok := strings.CutPrefix(rel, "docs/json/")
	if !ok || !strings.HasSuffix(rest, ".json") {
		return "", false
	}
	parts := strings.Split(rest, "/")
	if len(parts) != 3 || (parts[0] != "radarr" && parts[0] != "sonarr") {
		return "", false
	}
	switch parts[1] {
	case "cf", "cf-groups", "quality-profiles":
		return path.Join(parts...), true
	}
	return "", false
}
