package silo

import (
	"encoding/json"
	"fmt"
	"strings"

	pluginv1 "github.com/Silo-Server/silo-plugin-sdk/pkg/pluginproto/silo/plugin/v1"
)

// Repository renders silo-repository.json for a release: the catalog format of
// Silo-Server/silo-plugins (manifest.json) with this one plugin in it. Users add
// https://github.com/hyprsh/kestrel/releases/latest/download/silo-repository.json
// in Silo. The format follows Silo's own catalog; it is not documented anywhere
// else, so a Silo release that changes it needs this updated. The manifest's
// supported_platforms name the binaries, as GoReleaser names them
// (.goreleaser.yaml): kestrel-silo-<os>-<arch>.
func Repository(version string) ([]byte, error) {
	v := strings.TrimPrefix(version, "v")
	if v == "" || v == "dev" || v == "edge" {
		return nil, fmt.Errorf("silo repository: %q is not a release version", version)
	}
	m, err := Manifest(v)
	if err != nil {
		return nil, err
	}
	m.Checksum = "" // the checksum is the build's; checksums.txt carries the real ones

	const repo = "https://github.com/hyprsh/kestrel"
	base := fmt.Sprintf("%s/releases/download/v%s/", repo, v)
	type binary struct {
		URL string `json:"url"`
	}
	binaries := map[string]binary{}
	for _, p := range m.GetSupportedPlatforms() {
		binaries[p.GetOs()+"/"+p.GetArch()] = binary{URL: base + "kestrel-silo-" + p.GetOs() + "-" + p.GetArch()}
	}
	// Silo reads the file with encoding/json, not protojson, so the manifest is
	// written the same way: enums as numbers, as Silo-Server/silo-plugins does.
	// An entry is one plugin of the catalog.
	type entry struct {
		Manifest     *pluginv1.PluginManifest `json:"manifest"`
		RepoURL      string                   `json:"repo_url"`
		ChecksumsURL string                   `json:"checksums_url"`
		Binaries     map[string]binary        `json:"binaries"`
	}
	doc := struct {
		Plugins []entry `json:"plugins"`
	}{[]entry{{Manifest: m, RepoURL: repo, ChecksumsURL: base + "checksums.txt", Binaries: binaries}}}
	return json.MarshalIndent(doc, "", "  ")
}
