package api

import (
	"testing"

	"github.com/hyprsh/kestrel/internal/release"
)

// With no snapshot, or a Profile it cannot resolve, a Profile scores nothing: empty lists, not null, and no error.
func TestProfileScoringWithoutAResolvedProfileIsEmptyNotNull(t *testing.T) {
	for _, kind := range []release.Kind{release.KindMovie, release.KindSeries} {
		got := profileScoring(nil, kind)
		if got.Qualities == nil || len(got.Qualities) != 0 || got.CustomFormats == nil || len(got.CustomFormats) != 0 || got.MinScore != 0 {
			t.Errorf("%v: %+v", kind, got)
		}
	}
}
