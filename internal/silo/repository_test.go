package silo

import (
	"encoding/json"
	"slices"
	"testing"

	pluginv1 "github.com/Silo-Server/silo-plugin-sdk/pkg/pluginproto/silo/plugin/v1"
	"github.com/Silo-Server/silo-plugin-sdk/pkg/pluginsdk/manifest"
)

// TestSiloCanReadTheRepository decodes silo-repository.json as Silo does
// (internal/plugins/catalog_service.go): encoding/json into the SDK's
// PluginManifest, which takes enums as numbers, then the SDK's validation.
func TestSiloCanReadTheRepository(t *testing.T) {
	b, err := Repository("v0.2.0")
	if err != nil {
		t.Fatal(err)
	}
	var repo struct {
		Plugins []struct {
			Manifest *pluginv1.PluginManifest `json:"manifest"`
		} `json:"plugins"`
	}
	if err := json.Unmarshal(b, &repo); err != nil {
		t.Fatalf("Silo cannot decode the repository: %v", err)
	}
	if len(repo.Plugins) != 1 {
		t.Fatalf("plugins = %d", len(repo.Plugins))
	}
	m := repo.Plugins[0].Manifest
	if err := manifest.Validate(m); err != nil {
		t.Fatalf("Silo rejects the manifest: %v", err)
	}
	if m.GetSiloApiVersion() != "v1" {
		t.Errorf("silo_api_version = %q, want v1", m.GetSiloApiVersion())
	}
	fields := m.GetCapabilities()[0].GetConfigSchema()[0].GetAdminForm().GetFields()
	want := map[string]pluginv1.AdminFormControl{
		"hd_profile":  pluginv1.AdminFormControl_ADMIN_FORM_CONTROL_SELECT,
		"uhd_profile": pluginv1.AdminFormControl_ADMIN_FORM_CONTROL_SELECT,
		"also_add_sd": pluginv1.AdminFormControl_ADMIN_FORM_CONTROL_SWITCH,
	}
	for _, f := range fields {
		if f.GetControl() != want[f.GetKey()] {
			t.Errorf("%s control = %v, want %v", f.GetKey(), f.GetControl(), want[f.GetKey()])
		}
	}
	if len(fields) != len(want) {
		t.Errorf("fields = %d, want %d", len(fields), len(want))
	}
}

func TestRepositoryListsTheThreeBinariesOfThisRelease(t *testing.T) {
	b, err := Repository("v0.2.0")
	if err != nil {
		t.Fatal(err)
	}
	var repo struct {
		Plugins []struct {
			Manifest struct {
				PluginID  string                      `json:"plugin_id"`
				Version   string                      `json:"version"`
				Checksum  string                      `json:"checksum"`
				Platforms []struct{ OS, Arch string } `json:"supported_platforms"`
			} `json:"manifest"`
			RepoURL      string                       `json:"repo_url"`
			ChecksumsURL string                       `json:"checksums_url"`
			Binaries     map[string]map[string]string `json:"binaries"`
		} `json:"plugins"`
	}
	if err := json.Unmarshal(b, &repo); err != nil {
		t.Fatal(err)
	}
	if len(repo.Plugins) != 1 {
		t.Fatalf("plugins = %d", len(repo.Plugins))
	}
	p := repo.Plugins[0]
	if p.Manifest.PluginID != "hyprsh.kestrel" || p.Manifest.Version != "0.2.0" || p.Manifest.Checksum != "" {
		t.Errorf("manifest = %+v", p.Manifest)
	}
	if len(p.Manifest.Platforms) != 3 {
		t.Errorf("platforms = %+v", p.Manifest.Platforms)
	}
	const base = "https://github.com/hyprsh/kestrel/releases/download/v0.2.0/"
	if p.ChecksumsURL != base+"checksums.txt" || p.RepoURL != "https://github.com/hyprsh/kestrel" {
		t.Errorf("urls = %q %q", p.RepoURL, p.ChecksumsURL)
	}
	want := map[string]string{
		"linux/amd64":  base + "kestrel-silo-linux-amd64",
		"linux/arm64":  base + "kestrel-silo-linux-arm64",
		"darwin/arm64": base + "kestrel-silo-darwin-arm64",
	}
	for k, u := range want {
		if p.Binaries[k]["url"] != u {
			t.Errorf("binaries[%s] = %q, want %q", k, p.Binaries[k]["url"], u)
		}
	}
}

func TestRepositoryNeedsAReleaseVersion(t *testing.T) {
	for _, v := range []string{"", "dev", "edge"} {
		if _, err := Repository(v); err == nil {
			t.Errorf("Repository(%q) should fail", v)
		}
	}
}

// TestTheBinaryReportsThePlatformsTheRepositoryShips checks the manifest
// kestrel-silo prints, as runtime.ServeManifest loads it, against what Silo
// asks of it at install (internal/plugins/manifest.go): a checksum and
// supported platforms, here the ones the repository has binaries for.
func TestTheBinaryReportsThePlatformsTheRepositoryShips(t *testing.T) {
	m, err := manifest.LoadWithChecksum(ManifestJSON(), "0.2.0")
	if err != nil {
		t.Fatal(err)
	}
	if m.GetChecksum() == "" {
		t.Error("the manifest has no checksum")
	}
	b, err := Repository("v0.2.0")
	if err != nil {
		t.Fatal(err)
	}
	var repo struct {
		Plugins []struct {
			Binaries map[string]any `json:"binaries"`
		} `json:"plugins"`
	}
	if err := json.Unmarshal(b, &repo); err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, p := range m.GetSupportedPlatforms() {
		got = append(got, p.GetOs()+"/"+p.GetArch())
	}
	var want []string
	for k := range repo.Plugins[0].Binaries {
		want = append(want, k)
	}
	slices.Sort(got)
	slices.Sort(want)
	if !slices.Equal(got, want) {
		t.Errorf("supported_platforms = %v, want the repository's binaries %v", got, want)
	}
}
