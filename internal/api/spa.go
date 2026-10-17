package api

import (
	"bytes"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// spa serves the built web UI: files as they are, and index.html for every
// extension-less path the client-side router owns. The index carries a
// <base href> that the build leaves at "/" and that is rewritten to the
// instance's base URL, so the SPA's relative asset and API URLs work under any
// prefix.
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
