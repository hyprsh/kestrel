package api_test

import (
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
)

// ADR 0027: `uhd` is not a resolution; a request that sends it is refused with a problem naming the field.
func TestResolutionUhdIsRefusedWith422NamingTheField(t *testing.T) {
	t.Parallel()
	b := newLibraryInstance(t, metadatatest.Key)
	r := b.valid("POST", "/profiles", `{"release_family":"remux-web","resolution":"uhd","language_rule":"primary"}`)
	if r.Status != 422 || !strings.Contains(r.Body, `"field":"resolution"`) {
		t.Fatalf("import with uhd = %d %s, want 422 naming resolution", r.Status, r.Body)
	}
	r = b.valid("POST", "/profiles", `{"release_family":"web","resolution":"4k","language_rule":"original"}`)
	if r.Status != 201 {
		t.Fatalf("import with 4k = %d %s", r.Status, r.Body)
	}
	if p := decode[profileJSON](t, r); p.Resolution != "4k" {
		t.Errorf("imported with 4k = %+v", p)
	}
}
