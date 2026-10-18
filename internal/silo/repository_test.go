package silo

import (
	"encoding/json"
	"testing"
)

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
