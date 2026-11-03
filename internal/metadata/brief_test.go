package metadata_test

import (
	"context"
	"strings"
	"testing"

	"github.com/hyprsh/kestrel/internal/metadata"
	"github.com/hyprsh/kestrel/internal/metadata/metadatatest"
)

func TestBriefTellsASeriesAndAMovieApartAndIsCached(t *testing.T) {
	tm, srv := newTMDB(t, metadatatest.Key)
	ctx := context.Background()
	s, err := tm.Brief(ctx, metadata.Series, 1396)
	if err != nil {
		t.Fatal(err)
	}
	if s != (metadata.Brief{Network: "AMC", Country: "US", Seasons: 5, Runtime: 47}) {
		t.Errorf("series = %+v", s)
	}
	m, err := tm.Brief(ctx, metadata.Movie, 116149)
	if err != nil {
		t.Fatal(err)
	}
	if m != (metadata.Brief{Network: "Heyday Films", Country: "GB", Runtime: 95}) {
		t.Errorf("movie = %+v", m)
	}
	if _, err := tm.Brief(ctx, metadata.Series, 1396); err != nil {
		t.Fatal(err)
	}
	asked := 0
	for _, r := range srv.Requests() {
		if strings.HasPrefix(r, "/3/tv/1396?") {
			asked++
			if strings.Contains(r, "append_to_response") {
				t.Errorf("the brief asked for the heavy details: %s", r)
			}
		}
	}
	if asked != 1 {
		t.Errorf("TMDB was asked %d times for the same Series, want once", asked)
	}
}

func TestSearchCarriesASeriesOriginCountry(t *testing.T) {
	tm, _ := newTMDB(t, metadatatest.Key)
	got, err := tm.Search(context.Background(), "paddington")
	if err != nil {
		t.Fatal(err)
	}
	if got[0].OriginCountry != "" || got[1].OriginCountry != "GB" {
		t.Errorf("countries = %q, %q", got[0].OriginCountry, got[1].OriginCountry)
	}
}
