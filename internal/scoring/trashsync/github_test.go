package trashsync_test

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/hyprsh/kestrel/internal/scoring/trashsync"
)

func TestGitHubSourceKeepsOnlyWhatKestrelReads(t *testing.T) {
	archive := func() []byte {
		var sb strings.Builder
		zw := gzip.NewWriter(&sb)
		tw := tar.NewWriter(zw)
		for name, body := range map[string]string{
			"TRaSH-Guides-Guides-abc/LICENSE":                                  "MIT",
			"TRaSH-Guides-Guides-abc/docs/json/radarr/cf/a.json":               "{}",
			"TRaSH-Guides-Guides-abc/docs/json/sonarr/cf-groups/g.json":        "{}",
			"TRaSH-Guides-Guides-abc/docs/json/radarr/quality-profiles/p.json": "{}",
			"TRaSH-Guides-Guides-abc/docs/json/radarr/naming/n.json":           "{}",
			"TRaSH-Guides-Guides-abc/docs/json/radarr/cf/dummy-files/x.json":   "{}",
			"TRaSH-Guides-Guides-abc/README.md":                                "hi",
		} {
			_ = tw.WriteHeader(&tar.Header{Name: name, Typeflag: tar.TypeReg, Size: int64(len(body)), Mode: 0o644})
			_, _ = tw.Write([]byte(body))
		}
		tw.Close()
		zw.Close()
		return []byte(sb.String())
	}()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/TRaSH-Guides/Guides/commits/master":
			_, _ = w.Write([]byte(`{"sha":"abc","commit":{"committer":{"date":"2026-10-12T17:15:34Z"}}}`))
		case "/repos/TRaSH-Guides/Guides/tarball/abc":
			_, _ = w.Write(archive)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	g := trashsync.GitHub{BaseURL: srv.URL}
	ref, err := g.Latest(context.Background())
	if err != nil || ref.Commit != "abc" || !ref.CommittedAt.Equal(time.Date(2026, 10, 12, 17, 15, 34, 0, time.UTC)) {
		t.Fatalf("Latest = %+v, %v", ref, err)
	}
	files, err := g.Download(context.Background(), ref)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	_ = fs.WalkDir(files, ".", func(p string, d fs.DirEntry, _ error) error {
		if !d.IsDir() {
			got = append(got, p)
		}
		return nil
	})
	want := "COMMIT COMMITTED_AT LICENSE radarr/cf/a.json radarr/quality-profiles/p.json sonarr/cf-groups/g.json"
	if strings.Join(got, " ") != want {
		t.Errorf("files = %v, want %s", got, want)
	}
}

func TestGitHubCommitsAreTheOnesBetweenTheTwoThatTouchTheJSON(t *testing.T) {
	var asked string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked = r.URL.String()
		_, _ = w.Write([]byte(`[
			{"sha":"ccc3333","commit":{"message":"feat(radarr): add FLUX to WEB Tier 01\n\nlonger body"}},
			{"sha":"bbb2222","commit":{"message":"fix: typo"}},
			{"sha":"aaa1111","commit":{"message":"the old one"}},
			{"sha":"zzz0000","commit":{"message":"before"}}
		]`))
	}))
	defer srv.Close()
	from := trashsync.Ref{Commit: "aaa1111", CommittedAt: time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)}
	got, err := trashsync.GitHub{BaseURL: srv.URL}.Commits(context.Background(), from, "ccc3333")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(asked, "sha=ccc3333") || !strings.Contains(asked, "path=docs%2Fjson") || !strings.Contains(asked, "since=2026-10-01") {
		t.Errorf("asked %s", asked)
	}
	want := []trashsync.Commit{{SHA: "ccc3333", Message: "feat(radarr): add FLUX to WEB Tier 01"}, {SHA: "bbb2222", Message: "fix: typo"}}
	if len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Errorf("commits = %+v", got)
	}
}
