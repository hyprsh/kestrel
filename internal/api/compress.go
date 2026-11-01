package api

import (
	"compress/gzip"
	"net/http"
	"strings"
	"sync"
)

// gzipPool keeps the writers between responses: a gzip.Writer is a few hundred kilobytes of state.
var gzipPool = sync.Pool{New: func() any {
	zw, _ := gzip.NewWriterLevel(nil, gzip.DefaultCompression)
	return zw
}}

// compressJSON gzips the JSON an API answers with for a client that accepts it. A phone on a slow link waits for the bytes,
// and the Title's episodes or the Grab list are tens of kilobytes of repeated keys that shrink to a tenth. Everything else
// passes through as it is: the live stream must reach the browser as it is written, the web assets are compressed by the
// file handler, and an answer that already says how it is encoded stays that way.
func compressJSON(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !acceptsGzip(r) || r.Method == http.MethodHead || strings.HasSuffix(r.URL.Path, "/stream") {
			next.ServeHTTP(w, r)
			return
		}
		gw := &gzipResponse{ResponseWriter: w}
		defer gw.close()
		next.ServeHTTP(gw, r)
	})
}

type gzipResponse struct {
	http.ResponseWriter
	zw      *gzip.Writer
	decided bool
}

func (g *gzipResponse) decide(status int) {
	if g.decided {
		return
	}
	g.decided = true
	h := g.Header()
	h.Add("Vary", "Accept-Encoding")
	ct := h.Get("Content-Type")
	jsonBody := strings.HasPrefix(ct, "application/json") || strings.HasPrefix(ct, "application/problem+json")
	if jsonBody && h.Get("Content-Encoding") == "" && status != http.StatusNoContent && status != http.StatusNotModified && status >= 200 {
		g.zw = gzipPool.Get().(*gzip.Writer)
		g.zw.Reset(g.ResponseWriter)
		h.Set("Content-Encoding", "gzip")
		h.Del("Content-Length")
	}
}

func (g *gzipResponse) WriteHeader(status int) {
	g.decide(status)
	g.ResponseWriter.WriteHeader(status)
}

func (g *gzipResponse) Write(b []byte) (int, error) {
	g.decide(http.StatusOK)
	if g.zw != nil {
		return g.zw.Write(b)
	}
	return g.ResponseWriter.Write(b)
}

// Flush lets a handler that streams (a long download of a file, say) push what it has written.
func (g *gzipResponse) Flush() {
	if g.zw != nil {
		_ = g.zw.Flush()
	}
	if f, ok := g.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (g *gzipResponse) Unwrap() http.ResponseWriter { return g.ResponseWriter }

func (g *gzipResponse) close() {
	if g.zw != nil {
		_ = g.zw.Close()
		gzipPool.Put(g.zw)
	}
}
