package api

import (
	"bytes"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
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
}

func newSPA(files fs.FS, baseURL string) http.Handler {
	s := &spa{files: files}
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
