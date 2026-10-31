// Command gen-notices writes internal/notices/THIRD_PARTY_NOTICES.md: Kestrel's
// own licence, the ported Radarr/Sonarr code, the bundled TRaSH data, and the
// licence texts of the Go and npm dependencies. Run it through scripts/gen-notices.sh,
// which prepares the dependency inputs.
//
//	go run ./scripts/gen-notices -go-licenses DIR -npm-paths FILE -out FILE
package main

import (
	"bufio"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/hyprsh/kestrel/internal/release"
)

func main() {
	goDir := flag.String("go-licenses", "", "directory written by `go-licenses save`")
	npmPaths := flag.String("npm-paths", "", "file listing the production npm package directories, one per line")
	out := flag.String("out", "", "file to write")
	flag.Parse()
	if *goDir == "" || *npmPaths == "" || *out == "" {
		flag.Usage()
		os.Exit(2)
	}

	// The embedded snapshot's files; the script runs from the repository root.
	trashLicense, err := os.ReadFile("internal/scoring/trash/LICENSE")
	if err != nil {
		log.Fatal(err)
	}
	trashCommit, err := os.ReadFile("internal/scoring/trash/COMMIT")
	if err != nil {
		log.Fatal(err)
	}

	var b strings.Builder
	b.WriteString("# Third-party notices\n\n")
	b.WriteString("Kestrel is licensed under the GNU General Public License v3.0 only (GPL-3.0-only). It includes the following.\n\n")

	b.WriteString("## Radarr and Sonarr (ported code)\n\n")
	fmt.Fprintf(&b, "Release-name parsing is a Go port of Radarr %s (commit `%s`, https://github.com/Radarr/Radarr) and of Sonarr %s (commit `%s`, https://github.com/Sonarr/Sonarr). Both are licensed under GPL-3.0; the ported code and its test fixtures keep that licence.\n\n",
		release.UpstreamRadarrVersion, release.UpstreamRadarr, release.UpstreamSonarrVersion, release.UpstreamSonarr)

	b.WriteString("## TRaSH Guides (bundled data)\n\n")
	fmt.Fprintf(&b, "Custom Formats and quality profiles come from https://github.com/TRaSH-Guides/Guides, bundled at commit `%s` and updated from there. Licence (MIT):\n\n", strings.TrimSpace(string(trashCommit)))
	b.WriteString(indent(string(trashLicense)))

	b.WriteString("\n## Trademark assets (bundled logos)\n\n")
	b.WriteString("These logos are trademarks of their owners, used under the owners' terms. Their use does not imply endorsement or certification by the owner.\n\n")
	for _, a := range trademarkAssets {
		if _, err := os.Stat(a.file); err != nil {
			log.Fatal(err)
		}
		fmt.Fprintf(&b, "- %s (`%s`), a trademark of %s. Source: %s. Used per %s. Not endorsed or certified by %s.\n",
			a.name, a.file, a.owner, a.source, a.terms, a.owner)
	}

	b.WriteString("\n## Go modules\n\n")
	goMods := collectGo(*goDir)
	for _, m := range goMods {
		fmt.Fprintf(&b, "### %s\n\n%s\n", m.name, indent(m.text))
	}

	b.WriteString("## npm packages (the web app)\n\n")
	for _, m := range collectNPM(*npmPaths) {
		fmt.Fprintf(&b, "### %s\n\n%s\n", m.name, indent(m.text))
	}

	if err := os.WriteFile(*out, []byte(b.String()), 0o644); err != nil {
		log.Fatal(err)
	}
}

// trademarkAsset is a bundled third-party logo. To list another, add one entry.
type trademarkAsset struct {
	name, owner, file, source, terms string
}

// trademarkAssets are relative to the repository root.
var trademarkAssets = []trademarkAsset{
	{
		name:   "TMDB logo",
		owner:  "TMDB",
		file:   "web/src/assets/tmdb-blue-short.svg",
		source: "https://www.themoviedb.org/about/logos-attribution",
		terms:  "https://www.themoviedb.org/api-terms-of-use",
	},
}

type module struct{ name, text string }

func isLicenseFile(n string) bool {
	u := strings.ToUpper(n)
	for _, p := range []string{"LICENSE", "LICENCE", "COPYING", "NOTICE"} {
		if strings.HasPrefix(u, p) {
			return true
		}
	}
	return false
}

func collectGo(root string) []module {
	texts := map[string][]string{}
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !isLicenseFile(d.Name()) {
			return err
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, filepath.Dir(p))
		texts[filepath.ToSlash(rel)] = append(texts[filepath.ToSlash(rel)], strings.TrimSpace(string(b)))
		return nil
	})
	if err != nil {
		log.Fatal(err)
	}
	return sorted(texts)
}

func collectNPM(list string) []module {
	f, err := os.Open(list)
	if err != nil {
		log.Fatal(err)
	}
	defer f.Close()
	texts := map[string][]string{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		dir := strings.TrimSpace(sc.Text())
		if dir == "" {
			continue
		}
		// The name is the path below the last node_modules.
		name := dir
		if i := strings.LastIndex(dir, "node_modules/"); i >= 0 {
			name = dir[i+len("node_modules/"):]
		}
		entries, _ := os.ReadDir(dir)
		for _, e := range entries {
			if e.IsDir() || !isLicenseFile(e.Name()) {
				continue
			}
			if b, err := os.ReadFile(filepath.Join(dir, e.Name())); err == nil {
				texts[name] = append(texts[name], strings.TrimSpace(string(b)))
			}
		}
		if _, ok := texts[name]; !ok {
			texts[name] = []string{"(no licence file shipped; see the package's registry entry)"}
		}
	}
	return sorted(texts)
}

func sorted(m map[string][]string) []module {
	var out []module
	for n, t := range m {
		out = append(out, module{n, strings.Join(t, "\n\n")})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].name < out[j].name })
	return out
}

func indent(s string) string {
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	for i, l := range lines {
		lines[i] = "    " + l
	}
	return strings.Join(lines, "\n") + "\n"
}
