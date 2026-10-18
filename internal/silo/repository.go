package silo

import (
	"encoding/json"
	"fmt"
	"strings"
)

// platforms are the binaries each release ships, as GoReleaser names them
// (.goreleaser.yaml): kestrel-silo-<os>-<arch>.
var platforms = []struct{ OS, Arch string }{
	{"linux", "amd64"},
	{"linux", "arm64"},
	{"darwin", "arm64"},
}

// Repository renders silo-repository.json for a release: the catalog format of
// Silo-Server/silo-plugins (manifest.json) with this one plugin in it. Users add
// https://github.com/hyprsh/kestrel/releases/latest/download/silo-repository.json
// in Silo. The format follows Silo's own catalog; it is not documented anywhere
// else, so a Silo release that changes it needs this updated.
func Repository(version string) ([]byte, error) {
	v := strings.TrimPrefix(version, "v")
	if v == "" || v == "dev" || v == "edge" {
		return nil, fmt.Errorf("silo repository: %q is not a release version", version)
	}
	var m map[string]any
	if err := json.Unmarshal(manifestJSON, &m); err != nil {
		return nil, err
	}
	m["version"] = v
	delete(m, "checksum") // the checksum is the build's; checksums.txt carries the real ones
	var sp []map[string]string
	for _, p := range platforms {
		sp = append(sp, map[string]string{"os": p.OS, "arch": p.Arch})
	}
	m["supported_platforms"] = sp

	const repo = "https://github.com/hyprsh/kestrel"
	base := fmt.Sprintf("%s/releases/download/v%s/", repo, v)
	binaries := map[string]any{}
	for _, p := range platforms {
		binaries[p.OS+"/"+p.Arch] = map[string]string{"url": base + "kestrel-silo-" + p.OS + "-" + p.Arch}
	}
	doc := map[string]any{"plugins": []any{map[string]any{
		"manifest":      m,
		"repo_url":      repo,
		"checksums_url": base + "checksums.txt",
		"binaries":      binaries,
	}}}
	return json.MarshalIndent(doc, "", "  ")
}
