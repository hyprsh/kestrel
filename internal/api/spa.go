package api

import (
	"bytes"
	"compress/gzip"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
	"sync"
	"time"
)

func init() {
	// The web app manifest; Go's built-in table lacks it and a minimal image has no mime.types.
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
}

// spa serves the built web UI: files as they are, and index.html for every
// extension-less path the client-side router owns. The index carries a
// <base href> that the build leaves at "/" and that is rewritten to the
// instance's base URL, so the SPA's relative asset and API URLs work under any
// prefix. The web app manifest and its icons are plain files; the index links
// them relative to that <base href>, and the manifest's own start_url, scope and
// icon URLs are relative to the manifest, so they follow the prefix too.
type spa struct {
	files fs.FS
	index []byte // nil when the SPA isn't built

	mu   sync.Mutex
	gzip map[string][]byte // the gzipped bytes of each built asset, made on first request
}

func newSPA(files fs.FS, baseURL string) http.Handler {
	s := &spa{files: files, gzip: map[string][]byte{}}
	if files != nil {
		if raw, err := fs.ReadFile(files, "index.html"); err == nil {
			s.index = bytes.Replace(raw, []byte(`<base href="/" />`), []byte(`<base href="`+baseURL+`/" />`), 1)
		}
	}
	return s
}

func (s *spa) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if s.index == nil {
		http.Error(w, "the web UI is not built into this binary", http.StatusServiceUnavailable)
		return
	}
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if name != "" && name != "index.html" {
		if f, err := s.files.Open(name); err == nil {
			info, statErr := f.Stat()
			f.Close()
			if statErr == nil && !info.IsDir() {
				if strings.HasPrefix(name, "assets/") && s.serveAsset(w, r, name) {
					return
				}
				http.FileServerFS(s.files).ServeHTTP(w, r)
				return
			}
		}
		if path.Ext(name) != "" { // a missing file, not a client-side route
			http.NotFound(w, r)
			return
		}
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = w.Write(s.index)
}

// compressible says which built assets are worth gzipping; fonts and images are already compressed.
var compressible = map[string]bool{".js": true, ".css": true, ".svg": true, ".json": true, ".map": true}

// serveAsset serves a file of the build's assets/ folder, whose names carry a content hash: a browser keeps one for a
// year without asking again, and takes the gzipped bytes when it accepts them (the embedded files have no modification
// time, so the file server's own revalidation has nothing to compare, and it never compresses). It reports false when
// the file could not be read, so the caller falls back to the plain file server.
func (s *spa) serveAsset(w http.ResponseWriter, r *http.Request, name string) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	ext := path.Ext(name)
	raw, err := fs.ReadFile(s.files, name)
	if err != nil {
		return false
	}
	body := raw
	h := w.Header()
	h.Set("Cache-Control", "public, max-age=31536000, immutable")
	h.Set("Content-Type", mime.TypeByExtension(ext))
	if compressible[ext] {
		h.Add("Vary", "Accept-Encoding")
		if acceptsGzip(r) {
			if body = s.gzipped(name, raw); body != nil {
				h.Set("Content-Encoding", "gzip")
			} else {
				body = raw
			}
		}
	}
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(body))
	return true
}

// gzipped returns the gzip of raw, made once per file.
func (s *spa) gzipped(name string, raw []byte) []byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	if b, ok := s.gzip[name]; ok {
		return b
	}
	var buf bytes.Buffer
	zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	if _, err := zw.Write(raw); err != nil || zw.Close() != nil {
		return nil
	}
	s.gzip[name] = buf.Bytes()
	return s.gzip[name]
}

func acceptsGzip(r *http.Request) bool {
	for _, part := range strings.Split(r.Header.Get("Accept-Encoding"), ",") {
		coding, params, _ := strings.Cut(strings.TrimSpace(part), ";")
		if strings.EqualFold(strings.TrimSpace(coding), "gzip") {
			return strings.TrimSpace(params) != "q=0"
		}
	}
	return false
}
