package api_test

import (
	"testing"

	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
)

// ADR 0009: `uhd` is a deprecated alias of `4k` in a request, and a response always says `4k`.
func TestResolutionUhdIsADeprecatedAliasOf4k(t *testing.T) {
	t.Parallel()
	b := newLibraryInstance(t, metadatatest.Key)
	r := b.valid("POST", "/profiles", `{"release_family":"remux-web","resolution":"uhd","language_rule":"primary"}`)
	if r.Status != 201 {
		t.Fatalf("import with uhd = %d %s", r.Status, r.Body)
	}
	if p := decode[profileJSON](t, r); p.Resolution != "4k" || p.MinHeight != 2160 {
		t.Errorf("imported with uhd = %+v, want resolution 4k", p)
	}
	if r := b.valid("POST", "/profiles", `{"release_family":"remux-web","resolution":"4k","language_rule":"primary"}`); r.Status != 409 {
		t.Errorf("import with 4k after uhd = %d %s, want 409 (the same Profile)", r.Status, r.Body)
	}
	r = b.valid("POST", "/profiles", `{"release_family":"web","resolution":"4k","language_rule":"original"}`)
	if r.Status != 201 {
		t.Fatalf("import with 4k = %d %s", r.Status, r.Body)
	}
	if p := decode[profileJSON](t, r); p.Resolution != "4k" {
		t.Errorf("imported with 4k = %+v", p)
	}
	for _, p := range decode[struct {
		Items []profileJSON `json:"items"`
	}](t, b.valid("GET", "/profiles", "")).Items {
		if p.Resolution == "uhd" {
			t.Errorf("GET /profiles says uhd for %s", p.Key)
		}
	}
}
