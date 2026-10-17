// Command radarrgolden is a dev-only tool. It sends a corpus of Movie release
// names to a running, pinned Radarr instance (GET /api/v3/parse) and records
// the answers as a golden file. CI replays that file offline, without Docker
// or Radarr (internal/release golden test).
//
// Run it through scripts/regen-radarr-golden.sh, which starts the pinned
// container. The corpus is every title in the ported Radarr fixture files
// plus internal/release/testdata/golden/corpus-extra.txt.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/hyprsh/kestrel/internal/release"
)

// skipMethods are fixture methods whose first argument is not a release name.
var skipMethods = map[string]bool{
	"should_normalize_imdbid":                              true,
	"should_normalize_series_title":                        true,
	"should_remove_special_characters_and_casing":          true,
	"should_remove_common_words_from_middle_of_title":      true,
	"should_not_remove_common_words_from_end_of_title":     true,
	"should_not_remove_common_words_in_the_middle_of_word": true,
	"should_not_remove_from_the_beginning_of_the_title":    true,
	"should_not_clean_word_from_beginning_of_string":       true,
	"should_parse_subtitle_language_english":               true,
	"should_parse_subtitle_language":                       true,
	"should_parse_subtitle_language_unknown":               true,
	"should_parse_title_and_tags":                          true,
	"should_not_parse_false_title":                         true,
	"should_not_parse_random":                              true,
}

type golden struct {
	Radarr radarrPin    `json:"radarr"`
	Cases  []goldenCase `json:"cases"`
}

type radarrPin struct {
	Version     string `json:"version"`
	Commit      string `json:"commit"`
	Image       string `json:"image"`
	ImageDigest string `json:"imageDigest"`
	Endpoint    string `json:"endpoint"`
}

type goldenCase struct {
	Title string `json:"title"`
	// Parsed is Radarr's parsedMovieInfo, null when Radarr cannot parse the title.
	Parsed json.RawMessage `json:"parsed"`
}

func main() {
	base := flag.String("url", "http://localhost:17878", "Radarr base URL")
	key := flag.String("key", "", "Radarr API key")
	fixtures := flag.String("fixtures", "internal/release/testdata/radarr", "ported fixture JSON directory")
	extra := flag.String("extra", "internal/release/testdata/golden/corpus-extra.txt", "extra corpus, one name per line")
	out := flag.String("out", "internal/release/testdata/golden/radarr-parse.json", "golden file to write")
	image := flag.String("image", "", "pinned image reference")
	digest := flag.String("digest", "", "pinned image digest")
	flag.Parse()
	if *key == "" || *image == "" || *digest == "" {
		fatal(fmt.Errorf("-key, -image and -digest are required"))
	}

	version := radarrVersion(*base, *key)
	if want := strings.TrimPrefix(release.UpstreamRadarrVersion, "v"); version != want {
		fatal(fmt.Errorf("Radarr at %s is %s, the port is pinned to %s", *base, version, want))
	}

	titles, err := corpus(*fixtures, *extra)
	if err != nil {
		fatal(err)
	}

	g := golden{Radarr: radarrPin{
		Version: version, Commit: release.UpstreamRadarr, Image: *image, ImageDigest: *digest,
		Endpoint: "GET /api/v3/parse?title=",
	}}
	client := &http.Client{Timeout: 30 * time.Second}
	for i, title := range titles {
		parsed, err := parse(client, *base, *key, title)
		if err != nil {
			fatal(fmt.Errorf("%q: %w", title, err))
		}
		g.Cases = append(g.Cases, goldenCase{Title: title, Parsed: parsed})
		if (i+1)%200 == 0 {
			fmt.Printf("%d/%d\n", i+1, len(titles))
		}
	}

	data, err := json.MarshalIndent(g, "", "  ")
	if err != nil {
		fatal(err)
	}
	if err := os.WriteFile(*out, append(data, '\n'), 0o644); err != nil {
		fatal(err)
	}
	fmt.Printf("wrote %d cases to %s\n", len(g.Cases), *out)
}

func get(client *http.Client, base, key, path string) ([]byte, error) {
	req, err := http.NewRequest(http.MethodGet, base+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Api-Key", key)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s: %s: %s", path, resp.Status, body)
	}
	return body, nil
}

func radarrVersion(base, key string) string {
	body, err := get(http.DefaultClient, base, key, "/api/v3/system/status")
	if err != nil {
		fatal(err)
	}
	var s struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(body, &s); err != nil {
		fatal(err)
	}
	return s.Version
}

func parse(client *http.Client, base, key, title string) (json.RawMessage, error) {
	body, err := get(client, base, key, "/api/v3/parse?title="+url.QueryEscape(title))
	if err != nil {
		return nil, err
	}
	var resp struct {
		Parsed json.RawMessage `json:"parsedMovieInfo"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, err
	}
	if resp.Parsed == nil {
		return json.RawMessage("null"), nil
	}
	// Re-indent so the golden file diffs well.
	var v any
	if err := json.Unmarshal(resp.Parsed, &v); err != nil {
		return nil, err
	}
	return json.Marshal(v)
}

func corpus(fixturesDir, extraFile string) ([]string, error) {
	seen := map[string]bool{}
	var titles []string
	add := func(s string) {
		if strings.TrimSpace(s) == "" || strings.ContainsAny(s, "\\\x00") || seen[s] {
			return
		}
		seen[s] = true
		titles = append(titles, s)
	}

	files, err := filepath.Glob(filepath.Join(fixturesDir, "*.json"))
	if err != nil {
		return nil, err
	}
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			return nil, err
		}
		var fx struct {
			Cases []struct {
				Method string `json:"method"`
				Args   []any  `json:"args"`
			} `json:"cases"`
		}
		if err := json.Unmarshal(raw, &fx); err != nil {
			return nil, err
		}
		for _, c := range fx.Cases {
			if skipMethods[c.Method] || len(c.Args) == 0 {
				continue
			}
			if s, ok := c.Args[0].(string); ok {
				add(s)
			}
		}
	}

	raw, err := os.ReadFile(extraFile)
	if err != nil {
		return nil, err
	}
	for _, line := range strings.Split(string(raw), "\n") {
		add(strings.TrimRight(line, "\r"))
	}

	slices.Sort(titles)
	return titles, nil
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
