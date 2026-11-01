package api_test

import (
	"compress/gzip"
	"io"
	"net/http"
	"strings"
	"testing"
	"testing/fstest"
)

func TestBuiltAssetsAreCachedForAYearAndGzipped(t *testing.T) {
	t.Parallel()
	js := strings.Repeat("console.log('kestrel');\n", 200)
	srv := startServer(t, "/kestrel", fstest.MapFS{
		"index.html":            {Data: []byte(indexHTML)},
		"assets/index-abc.js":   {Data: []byte(js)},
		"assets/font-abc.woff2": {Data: []byte("woff2 bytes")},
	})
	fetch := func(path, encoding string) *http.Response {
		req, _ := http.NewRequest(http.MethodGet, srv.URL+"/kestrel/assets/"+path, nil)
		req.Header.Set("Accept-Encoding", encoding) // setting it by hand turns off the client's own decoding
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { res.Body.Close() })
		return res
	}

	res := fetch("index-abc.js", "br, gzip")
	if got := res.Header.Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Errorf("Cache-Control = %q, want a year, immutable", got)
	}
	if res.Header.Get("Content-Encoding") != "gzip" || res.Header.Get("Vary") != "Accept-Encoding" {
		t.Fatalf("Content-Encoding = %q, Vary = %q, want gzip for a client that accepts it", res.Header.Get("Content-Encoding"), res.Header.Get("Vary"))
	}
	zr, err := gzip.NewReader(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := io.ReadAll(zr); string(got) != js {
		t.Errorf("the gzipped body does not unzip to the asset")
	}
	if ct := res.Header.Get("Content-Type"); !strings.Contains(ct, "javascript") {
		t.Errorf("Content-Type = %q, want JavaScript", ct)
	}

	plain := fetch("index-abc.js", "")
	if plain.Header.Get("Content-Encoding") != "" {
		t.Errorf("a client that does not accept gzip got %q", plain.Header.Get("Content-Encoding"))
	}
	if b, _ := io.ReadAll(plain.Body); string(b) != js {
		t.Errorf("the plain body differs from the asset")
	}

	font := fetch("font-abc.woff2", "gzip")
	if font.Header.Get("Content-Encoding") != "" {
		t.Errorf("a font is already compressed, got Content-Encoding %q", font.Header.Get("Content-Encoding"))
	}
	if font.Header.Get("Cache-Control") == "" {
		t.Errorf("a font is a hashed asset too and should be cached")
	}
}
