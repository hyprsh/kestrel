package api_test

import (
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"testing"
)

func TestJSONAnswersAreGzippedForClientsThatAcceptIt(t *testing.T) {
	t.Parallel()
	srv := startServer(t, "", webFS)
	fetch := func(path, encoding string) *http.Response {
		req, _ := http.NewRequest(http.MethodGet, srv.URL+path, nil)
		if encoding != "" {
			req.Header.Set("Accept-Encoding", encoding) // by hand, so the client does not decode it
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { res.Body.Close() })
		return res
	}

	// An unauthenticated GET /auth/me answers a JSON problem; any JSON answer takes the same path.
	res := fetch("/api/v1/auth/me", "gzip")
	if res.Header.Get("Content-Encoding") != "gzip" || res.Header.Get("Vary") != "Accept-Encoding" {
		t.Fatalf("Content-Encoding = %q, Vary = %q, want gzip", res.Header.Get("Content-Encoding"), res.Header.Get("Vary"))
	}
	zr, err := gzip.NewReader(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	var problem map[string]any
	if err := json.NewDecoder(zr).Decode(&problem); err != nil || problem["code"] == nil {
		t.Fatalf("the gzipped body is not the problem: %v %v", problem, err)
	}

	plain := fetch("/api/v1/auth/me", "")
	if plain.Header.Get("Content-Encoding") != "" {
		t.Errorf("a client that does not accept gzip got %q", plain.Header.Get("Content-Encoding"))
	}
	if b, _ := io.ReadAll(plain.Body); !json.Valid(b) {
		t.Errorf("the plain body is not JSON: %s", b)
	}

	if page := fetch("/ping", "gzip"); page.Header.Get("Content-Encoding") != "" {
		t.Errorf("a plain-text answer should not be gzipped, got %q", page.Header.Get("Content-Encoding"))
	}
}
